/**
 * A4: sending an SOS and a flood report.
 *
 * The first group is safety rule 1: an SOS is never refused, whoever sends it and however often.
 * The rest checks that a sender reaches only their own case, that the suspected-spam flag stays
 * hidden from them, and that a report needs an account and has a rate limit.
 */
import type { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { as, asOwner, connect, expectDenied, rows } from "./db";
import { buildWorld, type World } from "./fixtures";

let db: Client;
let w: World;

beforeAll(async () => {
  db = await connect();
});
afterAll(async () => {
  await db?.end();
});
beforeEach(async () => {
  await db.query("begin");
  w = await buildWorld(db);
});
afterEach(async () => {
  await db.query("rollback");
});

const one = async <T>(sql: string, params: unknown[] = []) => (await rows<T>(db, sql, params))[0]!;

type Submitted = {
  sos_id: string;
  token: string | null;
  merged: boolean;
  status: string;
  created_at: Date;
};

/** Send an SOS the way the app does: as a visitor or a signed-in person, through submit_sos(). */
async function send(
  opts: {
    lat?: number;
    lon?: number;
    device?: string | null;
    phone?: string | null;
    text?: string | null;
  } = {},
): Promise<Submitted> {
  const point = await one<{ lat: number; lon: number }>(
    "select extensions.st_y(extensions.st_geomfromtext($1, 4326)) as lat, extensions.st_x(extensions.st_geomfromtext($1, 4326)) as lon",
    [w.yalaPoint],
  );
  return one<Submitted>(
    `select * from submit_sos(
       p_lat => $1, p_lon => $2, p_accuracy_m => 12, p_location_text => $3,
       p_device_id => $4, p_phone => $5)`,
    [
      opts.lat ?? point.lat,
      opts.lon ?? point.lon,
      opts.text ?? null,
      opts.device ?? null,
      opts.phone ?? null,
    ],
  );
}

describe("an SOS is never refused (safety rule 1)", () => {
  it("a visitor with no account and no phone can send one", async () => {
    await as(db, "anon");
    const sent = await send({ device: "device-a" });
    expect(sent.merged).toBe(false);
    expect(sent.status).toBe("received");
    expect(sent.token).toMatch(/^[0-9a-f]{48}$/);

    await asOwner(db);
    const row = await one<{
      requester_id: string | null;
      tambon: string;
      device_id: string;
      priority_score: number;
    }>("select requester_id, tambon, device_id, priority_score from sos_requests where id = $1", [
      sent.sos_id,
    ]);
    expect(row.requester_id).toBeNull();
    expect(row.tambon).toBe(w.yala1);
    expect(row.device_id).toBe("device-a");
    expect(row.priority_score).toBeGreaterThan(0);
    const events = await rows<{ event: string }>(
      db,
      "select event from sos_events where sos_id = $1",
      [sent.sos_id],
    );
    expect(events.map((e) => e.event)).toContain("received");
  });

  it("a repeat while the case is open merges into it instead of opening a second case", async () => {
    await as(db, "anon");
    const first = await send({ device: "device-b", phone: "66812345678" });
    const again = await send({ device: "device-b", lat: 6.5, lon: 101.3 });
    expect(again.merged).toBe(true);
    expect(again.sos_id).toBe(first.sos_id);
    // A merge never hands out the token again: only the first sender holds it.
    expect(again.token).toBeNull();

    await asOwner(db);
    const count = await one<{ n: string }>(
      "select count(*) as n from sos_requests where device_id = 'device-b'",
    );
    expect(Number(count.n)).toBe(1);
    const history = await one<{ n: string }>(
      "select count(*) as n from sos_locations where sos_id = $1",
      [first.sos_id],
    );
    expect(Number(history.n)).toBe(2);
    const events = await rows<{ event: string }>(
      db,
      "select event from sos_events where sos_id = $1 order by created_at",
      [first.sos_id],
    );
    expect(events.map((e) => e.event)).toEqual(["received", "repeat_merged"]);
  });

  it("a repeat from the same phone on another device merges too", async () => {
    await as(db, "anon");
    const first = await send({ device: "phone-1", phone: "66898765432" });
    const second = await send({ device: "phone-2", phone: "66898765432" });
    expect(second.sos_id).toBe(first.sos_id);
  });

  it("a closed case does not swallow the next SOS", async () => {
    await as(db, "anon");
    const first = await send({ device: "device-c" });
    await db.query("select sos_close($1, $2, false)", [first.sos_id, first.token]);
    const next = await send({ device: "device-c" });
    expect(next.merged).toBe(false);
    expect(next.sos_id).not.toBe(first.sos_id);
  });

  it("over the limit a new case is flagged suspected spam, created and delivered", async () => {
    await asOwner(db);
    await db.query(
      "update system_settings set value = '{\"per_device_24h\": 2, \"per_phone_24h\": 2}' where key = 'sos_spam_threshold'",
    );
    await as(db, "anon");
    const first = await send({ device: "flood-device" });
    await db.query("select sos_close($1, $2, false)", [first.sos_id, first.token]);
    const second = await send({ device: "flood-device" });
    await db.query("select sos_close($1, $2, false)", [second.sos_id, second.token]);
    const third = await send({ device: "flood-device" });

    expect(third.sos_id).toBeTruthy();
    expect(third.status).toBe("received");
    await asOwner(db);
    const review = await one<{ suspected_spam: boolean; spam_reason: string | null }>(
      "select suspected_spam, spam_reason from sos_review where sos_id = $1",
      [third.sos_id],
    );
    expect(review.suspected_spam).toBe(true);
    expect(review.spam_reason).toMatch(/24 hours/);
    const earlier = await one<{ suspected_spam: boolean }>(
      "select suspected_spam from sos_review where sos_id = $1",
      [first.sos_id],
    );
    expect(earlier.suspected_spam).toBe(false);
  });

  it("an SOS outside the covered provinces is still stored, without a tambon", async () => {
    await as(db, "anon");
    const sent = await send({ lat: 13.7563, lon: 100.5018, device: "far-away" });
    expect(sent.sos_id).toBeTruthy();
    await asOwner(db);
    const row = await one<{ tambon: string | null }>(
      "select tambon from sos_requests where id = $1",
      [sent.sos_id],
    );
    expect(row.tambon).toBeNull();
  });

  it("a phone number in a shape the column rejects is dropped, not a reason to refuse", async () => {
    await as(db, "anon");
    const sent = await send({ device: "bad-phone", phone: "ring me at home" });
    expect(sent.sos_id).toBeTruthy();
    await asOwner(db);
    const contact = await one<{ n: string }>(
      "select count(*) as n from sos_contacts where sos_id = $1",
      [sent.sos_id],
    );
    expect(Number(contact.n)).toBe(0);
  });

  it("a signed-in sender's case is tied to their account", async () => {
    await as(db, { uid: w.otherUser });
    const sent = await send({ device: "signed-in" });
    await asOwner(db);
    const row = await one<{ requester_id: string }>(
      "select requester_id from sos_requests where id = $1",
      [sent.sos_id],
    );
    expect(row.requester_id).toBe(w.otherUser);
  });
});

describe("a sender reaches only their own case", () => {
  it("the token opens the timeline, details, location and closing", async () => {
    await as(db, "anon");
    const sent = await send({ device: "mine" });
    const line = await one<{
      status: string;
      has_phone: boolean;
      events: { event: string }[];
      unit_name: string | null;
    }>("select * from sos_timeline($1, $2)", [sent.sos_id, sent.token]);
    expect(line.status).toBe("received");
    expect(line.has_phone).toBe(false);
    expect(line.events.map((e) => e.event)).toEqual(["received"]);
    expect(line.unit_name).toBeNull();

    await db.query(
      // The casts are for this direct SQL caller only: the app reaches these functions through
      // PostgREST, which converts the JSON values to the declared types itself.
      `select sos_add_details($1::uuid, $2::text, p_hazard_type => 'flood'::hazard_type,
         p_people_count => 4::smallint,
         p_vulnerable_flags => '{"elderly": true, "infant_child": true}'::jsonb,
         p_depth_ref => 'chest'::depth_ref, p_phone => '66800000001'::text)`,
      [sent.sos_id, sent.token],
    );
    await db.query("select sos_add_location($1, $2, 6.55, 101.28, 20)", [sent.sos_id, sent.token]);
    const after = await one<{ has_phone: boolean; events: { event: string }[] }>(
      "select * from sos_timeline($1, $2)",
      [sent.sos_id, sent.token],
    );
    expect(after.has_phone).toBe(true);
    expect(after.events.map((e) => e.event)).toContain("details_added");

    await asOwner(db);
    const row = await one<{ people_count: number; depth_ref: string; priority_score: number }>(
      "select people_count, depth_ref, priority_score from sos_requests where id = $1",
      [sent.sos_id],
    );
    expect(row.people_count).toBe(4);
    expect(row.depth_ref).toBe("chest");
    expect(row.priority_score).toBeGreaterThan(5);
    const locations = await one<{ n: string }>(
      "select count(*) as n from sos_locations where sos_id = $1",
      [sent.sos_id],
    );
    expect(Number(locations.n)).toBe(2);
  });

  it("a wrong or missing token reaches nothing", async () => {
    await as(db, "anon");
    const sent = await send({ device: "mine-2" });
    expect(await expectDenied(db, "select * from sos_timeline($1, $2)", [sent.sos_id, null])).toBe(
      "42501",
    );
    expect(
      await expectDenied(db, "select * from sos_timeline($1, $2)", [sent.sos_id, "x".repeat(48)]),
    ).toBe("42501");
    expect(
      await expectDenied(db, "select sos_close($1, $2, true)", [sent.sos_id, "x".repeat(48)]),
    ).toBe("42501");
    // Another signed-in person is no closer to it than a visitor.
    await as(db, { uid: w.otherUser });
    expect(await expectDenied(db, "select * from sos_timeline($1, null)", [sent.sos_id])).toBe(
      "42501",
    );
  });

  it("the signed-in sender needs no token", async () => {
    await as(db, { uid: w.requester });
    const line = await one<{ status: string }>("select * from sos_timeline($1, null)", [w.yalaSos]);
    expect(line.status).toBe("received");
  });

  it("the timeline never shows the suspected-spam flag (spec section 9)", async () => {
    await as(db, { uid: w.requester });
    const line = await one<Record<string, unknown>>("select * from sos_timeline($1, null)", [
      w.yalaSos,
    ]);
    expect(Object.keys(line)).not.toContain("suspected_spam");
    expect(JSON.stringify(line)).not.toMatch(/spam/i);
    // And the flag's own table stays out of reach: nothing to read, nothing to change.
    const visible = await rows(db, "select * from sos_review where sos_id = $1", [w.yalaSos]);
    expect(visible).toEqual([]);
    const tried = await db.query("update sos_review set suspected_spam = false where sos_id = $1", [
      w.yalaSos,
    ]);
    expect(tried.rowCount).toBe(0);
  });

  it('"I\'m safe now" and "Confirm I was rescued" close the case', async () => {
    await as(db, "anon");
    const safe = await send({ device: "safe-now" });
    const left = await one<{ sos_close: string }>("select sos_close($1, $2, false) as sos_close", [
      safe.sos_id,
      safe.token,
    ]);
    expect(left.sos_close).toBe("safe_cancelled");

    const rescued = await send({ device: "rescued" });
    const done = await one<{ sos_close: string }>("select sos_close($1, $2, true) as sos_close", [
      rescued.sos_id,
      rescued.token,
    ]);
    expect(done.sos_close).toBe("rescued");
    await asOwner(db);
    const confirmation = await one<{ method: string }>(
      "select method from rescue_confirmations where sos_id = $1",
      [rescued.sos_id],
    );
    expect(confirmation.method).toBe("requester");
    const closed = await one<{ closed_at: Date | null }>(
      "select closed_at from sos_requests where id = $1",
      [rescued.sos_id],
    );
    expect(closed.closed_at).not.toBeNull();
  });

  it("photos and a voice note are recorded on the case, never more than three photos", async () => {
    await as(db, "anon");
    const sent = await send({ device: "media" });
    const add = (photos: string[], voice: string | null) =>
      db.query(
        "select sos_add_media($1::uuid, $2::text, p_photos => $3::text[], p_voice_url => $4::text)",
        [sent.sos_id, sent.token, photos, voice],
      );
    await add(
      [`${sent.sos_id}/photo-1.jpg`, `${sent.sos_id}/photo-2.jpg`],
      `${sent.sos_id}/voice.m4a`,
    );
    // A fourth picture doesn't break the case: the first three are kept.
    await add([`${sent.sos_id}/photo-3.jpg`, `${sent.sos_id}/photo-4.jpg`], null);
    await asOwner(db);
    const row = await one<{ photos: string[]; voice_url: string }>(
      "select photos, voice_url from sos_requests where id = $1",
      [sent.sos_id],
    );
    expect(row.photos).toHaveLength(3);
    expect(row.voice_url).toContain("voice.m4a");
  });

  it("a closed case takes no more locations", async () => {
    await as(db, "anon");
    const sent = await send({ device: "closed" });
    await db.query("select sos_close($1, $2, true)", [sent.sos_id, sent.token]);
    await db.query("select sos_add_location($1, $2, 6.56, 101.29, 15)", [sent.sos_id, sent.token]);
    await asOwner(db);
    const locations = await one<{ n: string }>(
      "select count(*) as n from sos_locations where sos_id = $1",
      [sent.sos_id],
    );
    expect(Number(locations.n)).toBe(1);
  });

  it("the case token is never readable, only its hash is stored", async () => {
    await as(db, "anon");
    const sent = await send({ device: "secret" });
    await asOwner(db);
    const row = await one<{ token_hash: Buffer | null }>(
      "select token_hash from sos_requests where id = $1",
      [sent.sos_id],
    );
    expect(row.token_hash?.length).toBe(32);
    expect(row.token_hash?.toString("hex")).not.toContain(sent.token!);
    // A visitor cannot read the row at all, so the hash never leaves the database either.
    await as(db, "anon");
    expect(await rows(db, "select * from sos_requests where id = $1", [sent.sos_id])).toEqual([]);
  });
});

describe("who may write and read media (the storage policies)", () => {
  it("a visitor may write under their own young case, and nowhere else", async () => {
    await as(db, "anon");
    const sent = await send({ device: "media-policy" });
    // The policies ask these functions, because a policy's own subquery runs as the caller and a
    // visitor cannot read sos_requests at all - which silently refused every upload once.
    const mine = await one<{ ok: boolean }>("select sos_media_writable($1) as ok", [
      `${sent.sos_id}/photo-1.jpg`,
    ]);
    expect(mine.ok).toBe(true);
    const made_up = await one<{ ok: boolean }>("select sos_media_writable($1) as ok", [
      "00000000-0000-4000-8000-000000000000/photo-1.jpg",
    ]);
    expect(made_up.ok).toBe(false);
    const nonsense = await one<{ ok: boolean }>("select sos_media_writable($1) as ok", [
      "photo-1.jpg",
    ]);
    expect(nonsense.ok).toBe(false);

    await asOwner(db);
    await db.query("update sos_requests set created_at = now() - interval '2 days' where id = $1", [
      sent.sos_id,
    ]);
    await as(db, "anon");
    const old = await one<{ ok: boolean }>("select sos_media_writable($1) as ok", [
      `${sent.sos_id}/photo-1.jpg`,
    ]);
    expect(old.ok).toBe(false);
  });

  it("an SOS photo is readable only by a covering authority or an admin", async () => {
    const path = `${w.yalaSos}/photo-1.jpg`;
    await as(db, { uid: w.yalaRescue.user });
    expect((await one<{ ok: boolean }>("select sos_media_readable($1) as ok", [path])).ok).toBe(
      true,
    );
    await as(db, { uid: w.songkhlaRescue.user });
    expect((await one<{ ok: boolean }>("select sos_media_readable($1) as ok", [path])).ok).toBe(
      false,
    );
    await as(db, { uid: w.yalaPending.user });
    expect((await one<{ ok: boolean }>("select sos_media_readable($1) as ok", [path])).ok).toBe(
      false,
    );
    await as(db, { uid: w.admin });
    expect((await one<{ ok: boolean }>("select sos_media_readable($1) as ok", [path])).ok).toBe(
      true,
    );
    await as(db, { uid: w.requester });
    expect((await one<{ ok: boolean }>("select sos_media_readable($1) as ok", [path])).ok).toBe(
      false,
    );
    // A visitor is not even allowed to ask.
    await as(db, "anon");
    expect(await expectDenied(db, "select sos_media_readable($1)", [path])).toBe("42501");
  });

  it("report media belongs to its reporter, a covering authority and admins", async () => {
    await as(db, { uid: w.otherUser });
    const sent = await one<{ report_id: string }>(
      `select * from submit_report(
         p_lat => extensions.st_y(extensions.st_geomfromtext($1, 4326)),
         p_lon => extensions.st_x(extensions.st_geomfromtext($1, 4326)), p_depth_ref => 'knee')`,
      [w.yalaPoint],
    );
    const path = `${sent.report_id}/photo-1.jpg`;
    expect((await one<{ ok: boolean }>("select report_media_writable($1) as ok", [path])).ok).toBe(
      true,
    );
    expect((await one<{ ok: boolean }>("select report_media_readable($1) as ok", [path])).ok).toBe(
      true,
    );
    await as(db, { uid: w.requester });
    expect((await one<{ ok: boolean }>("select report_media_writable($1) as ok", [path])).ok).toBe(
      false,
    );
    expect((await one<{ ok: boolean }>("select report_media_readable($1) as ok", [path])).ok).toBe(
      false,
    );
    await as(db, { uid: w.yalaRescue.user });
    expect((await one<{ ok: boolean }>("select report_media_readable($1) as ok", [path])).ok).toBe(
      true,
    );
    await as(db, "anon");
    expect(await expectDenied(db, "select report_media_writable($1)", [path])).toBe("42501");
  });
});

describe("flood reports", () => {
  it("a signed-in person can send one and it gets its tambon", async () => {
    await as(db, { uid: w.otherUser });
    const sent = await one<{ report_id: string; tambon_code: string }>(
      `select * from submit_report(
         p_lat => extensions.st_y(extensions.st_geomfromtext($1, 4326)),
         p_lon => extensions.st_x(extensions.st_geomfromtext($1, 4326)),
         p_depth_ref => 'knee', p_trend => 'rising', p_road_access => 'motorbike_only',
         p_text => 'water over the road')`,
      [w.yalaPoint],
    );
    expect(sent.tambon_code).toBe(w.yala1);
    await asOwner(db);
    const row = await one<{ reporter_id: string; moderation_status: string; hazard_type: string }>(
      "select reporter_id, moderation_status, hazard_type from reports where id = $1",
      [sent.report_id],
    );
    expect(row).toEqual({
      reporter_id: w.otherUser,
      moderation_status: "pending",
      hazard_type: "flood",
    });
  });

  it("a visitor cannot send one (spec section 3)", async () => {
    await as(db, "anon");
    expect(await expectDenied(db, "select * from submit_report(6.54, 101.28)")).toBe("42501");
  });

  it("the rate limit refuses a flood of reports (unlike an SOS)", async () => {
    await asOwner(db);
    await db.query(
      "update system_settings set value = '{\"per_user_hour\": 2}' where key = 'report_limit'",
    );
    await as(db, { uid: w.otherUser });
    // The fixture world already holds one report from this person.
    await db.query("select * from submit_report(6.54, 101.28)");
    expect(await expectDenied(db, "select * from submit_report(6.54, 101.28)")).toBe("P0003");
  });

  it("a pending report never counts in the public hex bins", async () => {
    await as(db, { uid: w.otherUser });
    await db.query(
      `select * from submit_report(
         p_lat => extensions.st_y(extensions.st_geomfromtext($1, 4326)),
         p_lon => extensions.st_x(extensions.st_geomfromtext($1, 4326)), p_depth_ref => 'waist')`,
      [w.yalaPoint],
    );
    await as(db, "anon");
    const bins = await rows(db, "select * from report_hex_bins(72)");
    expect(bins).toEqual([]);
  });

  it("a reporter may add media to their own report but not change someone else's", async () => {
    await as(db, { uid: w.otherUser });
    const sent = await one<{ report_id: string }>(
      "select * from submit_report(6.54, 101.28, 'knee')",
    );
    await db.query("update reports set photos = $2 where id = $1", [
      sent.report_id,
      [`${sent.report_id}/1.jpg`],
    ]);
    await as(db, { uid: w.requester });
    const changed = await db.query("update reports set photos = '{}' where id = $1", [
      sent.report_id,
    ]);
    expect(changed.rowCount).toBe(0);
  });

  it("only admins read the settings table", async () => {
    await as(db, "anon");
    expect(await rows(db, "select * from system_settings")).toEqual([]);
    await as(db, { uid: w.otherUser });
    expect(await rows(db, "select * from system_settings")).toEqual([]);
    await as(db, { uid: w.admin });
    expect((await rows(db, "select * from system_settings")).length).toBeGreaterThan(0);
  });
});
