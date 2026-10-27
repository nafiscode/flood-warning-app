/**
 * A15: ratings, feedback and the public comments page (spec 17; safety rules 5 and 9).
 *
 * What is being guarded here, in the order the acceptance list asks for it:
 *  - a comment is invisible in public until an admin approves it;
 *  - an anonymous sender can withdraw a published one with the key their phone kept, and a
 *    signed-in one can withdraw their own;
 *  - a visitor can read **nothing** of a row but an approved display name, its two notes and its
 *    chips - no district, role, device, moment or case id;
 *  - a contact reveal is written to the access log;
 *  - a period under 20 answers publishes no average;
 *  - nothing a sender can get wrong raises, and the daily limit stores nothing instead.
 */
import type { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { as, asOwner, connect, createUser, expectDenied, rows } from "./db";
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
  // These tests are about the rows they add; jaga-dev carries whatever people have really sent.
  // The transaction is rolled back, so nothing is lost.
  await db.query("delete from feedback");
  await db.query("delete from feedback_outcomes");
});
afterEach(async () => {
  await db.query("rollback");
});

const one = async <T>(sql: string, params: unknown[] = []) => (await rows<T>(db, sql, params))[0]!;
const count = async (sql: string, params: unknown[] = []) =>
  Number((await rows<{ n: string }>(db, `select count(*) as n from (${sql}) q`, params))[0]!.n);

const auditCount = async (action: string, entityId: string) => {
  await asOwner(db);
  return count("select 1 from audit_log where action = $1 and entity_id = $2", [action, entityId]);
};

type Sent = { feedback_id: string | null; withdraw_key: string | null; limited: boolean };

/** Send one, as whoever the test is acting as. */
const send = (extra: Record<string, unknown> = {}) =>
  one<Sent>(
    `select * from submit_feedback(
       p_rating => $1::smallint, p_liked => $2::text[], p_liked_note => $3,
       p_improve => $4::text[], p_improve_note => $5, p_message => $6,
       p_screen => $7, p_locale => $8, p_device_kind => $9, p_district => $10,
       p_moment => $11, p_sos => $12::uuid, p_device_id => $13,
       p_contact_ok => $14, p_contact => $15, p_public_ok => $16, p_display_name => $17)`,
    [
      extra.rating ?? 4,
      extra.liked ?? ["risk_map"],
      extra.likedNote ?? null,
      extra.improve ?? [],
      extra.improveNote ?? null,
      extra.message ?? null,
      extra.screen ?? "/",
      extra.locale ?? "th",
      extra.deviceKind ?? "phone",
      extra.district ?? null,
      extra.moment ?? "menu",
      extra.sos ?? null,
      extra.deviceId ?? null,
      extra.contactOk ?? false,
      extra.contact ?? null,
      extra.publicOk ?? false,
      extra.displayName ?? null,
    ],
  );

/** A comment offered for the page, and approved by an admin. */
async function published(opts: { anonymous: boolean; name?: string | null }) {
  if (opts.anonymous) await as(db, "anon");
  else await as(db, { uid: w.requester });
  const sent = await send({
    publicOk: true,
    likedNote: "it warned me before the water came",
    improveNote: "the Malay is thin",
    improve: ["malay_incomplete"],
    displayName: opts.name ?? null,
    district: w.yala1.slice(0, 4),
    deviceId: "device-a",
  });
  await as(db, { uid: w.admin });
  await db.query("select admin_feedback_publish($1, 'approved')", [sent.feedback_id]);
  return sent;
}

describe("sending one", () => {
  it("takes anything a visitor can get wrong without raising", async () => {
    await as(db, "anon");
    // Nothing at all: no row, no error.
    const empty = await one<Sent>("select * from submit_feedback()");
    expect(empty.feedback_id).toBeNull();
    expect(empty.limited).toBe(false);
    // A rating out of range, chips that are not codes, an unknown district, a nonsense contact.
    const odd = await send({
      rating: 9,
      liked: ["Risk_Map", "", "a@b", "x"],
      district: "9999",
      contactOk: true,
      contact: "   ",
      likedNote: "  something  ",
    });
    expect(odd.feedback_id).not.toBeNull();
    await asOwner(db);
    const row = await one<{
      rating: number | null;
      liked: string[];
      district_code: string | null;
      contact: string | null;
      contact_ok: boolean;
      liked_note: string;
      role_at_time: string;
    }>("select * from feedback where id = $1", [odd.feedback_id]);
    expect(row.rating).toBeNull();
    expect(row.liked).toEqual(["risk_map"]);
    expect(row.district_code).toBeNull();
    expect(row.contact).toBeNull();
    expect(row.contact_ok).toBe(false);
    expect(row.liked_note).toBe("something");
    expect(row.role_at_time).toBe("visitor");
  });

  it("stores nothing over the daily limit, and says so rather than raising", async () => {
    await as(db, "anon");
    const limit = 3;
    for (let i = 0; i < limit; i += 1) {
      const sent = await send({ deviceId: "one-phone" });
      expect(sent.feedback_id).not.toBeNull();
    }
    const over = await send({ deviceId: "one-phone" });
    expect(over.limited).toBe(true);
    expect(over.feedback_id).toBeNull();
    await asOwner(db);
    expect(await count("select 1 from feedback where device_id = 'one-phone'")).toBe(limit);
  });

  it("keeps a contact only with the tick, and records the consent with its purpose", async () => {
    await as(db, { uid: w.requester });
    const withTick = await send({ contactOk: true, contact: "0812345678" });
    const withoutTick = await send({ contactOk: false, contact: "0899999999" });
    await asOwner(db);
    const a = await one<{ contact: string; contact_purpose: string; contact_consent_at: Date }>(
      "select contact, contact_purpose, contact_consent_at from feedback where id = $1",
      [withTick.feedback_id],
    );
    expect(a.contact).toBe("0812345678");
    expect(a.contact_purpose).not.toBeNull();
    expect(a.contact_consent_at).not.toBeNull();
    const b = await one<{ contact: string | null }>(
      "select contact from feedback where id = $1",
      [withoutTick.feedback_id],
    );
    expect(b.contact).toBeNull();
  });

  it("carries a case only when it is really this sender's own", async () => {
    await as(db, { uid: w.otherUser });
    const notTheirs = await send({ sos: w.yalaSos });
    await as(db, { uid: w.requester });
    const theirs = await send({ sos: w.yalaSos, moment: "closed_request" });
    await asOwner(db);
    expect(
      (
        await one<{ sos_id: string | null }>("select sos_id from feedback where id = $1", [
          notTheirs.feedback_id,
        ])
      ).sos_id,
    ).toBeNull();
    expect(
      (
        await one<{ sos_id: string | null }>("select sos_id from feedback where id = $1", [
          theirs.feedback_id,
        ])
      ).sos_id,
    ).toBe(w.yalaSos);
  });

  it("gives a withdrawal key only to an anonymous comment offered for the page", async () => {
    await as(db, "anon");
    const anonPublic = await send({ publicOk: true, likedNote: "good app" });
    expect(anonPublic.withdraw_key).not.toBeNull();
    const anonPrivate = await send({ publicOk: false, likedNote: "good app", deviceId: "d2" });
    expect(anonPrivate.withdraw_key).toBeNull();
    await as(db, { uid: w.requester });
    const signedIn = await send({ publicOk: true, likedNote: "good app" });
    expect(signedIn.withdraw_key).toBeNull();
  });

  it("leaves a bare rating unoffered: there is nothing to publish", async () => {
    await as(db, "anon");
    const sent = await send({ publicOk: true, rating: 5, likedNote: null, improveNote: null });
    await asOwner(db);
    expect(
      (
        await one<{ public_status: string }>("select public_status from feedback where id = $1", [
          sent.feedback_id,
        ])
      ).public_status,
    ).toBe("not_requested");
  });
});

describe("the table itself", () => {
  it("lets a signed-in sender read and delete their own, and nobody else's", async () => {
    await as(db, { uid: w.requester });
    const mine = await send({ likedNote: "mine" });
    await as(db, { uid: w.otherUser });
    const theirs = await send({ likedNote: "theirs" });

    await as(db, { uid: w.requester });
    expect(await count("select 1 from feedback")).toBe(1);
    expect(await count("select 1 from feedback where id = $1", [mine.feedback_id])).toBe(1);
    expect(await count("select 1 from feedback where id = $1", [theirs.feedback_id])).toBe(0);
    await db.query("delete from feedback where id = $1", [mine.feedback_id]);
    expect(await count("select 1 from feedback")).toBe(0);
    await asOwner(db);
    expect(await count("select 1 from feedback where id = $1", [theirs.feedback_id])).toBe(1);
  });

  it("shows a visitor nothing, and lets nobody write to it directly", async () => {
    await as(db, { uid: w.requester });
    await send();
    await as(db, "anon");
    expect(await count("select 1 from feedback")).toBe(0);
    expect(await expectDenied(db, "insert into feedback (rating) values (5)")).toBe("42501");
    await as(db, { uid: w.requester });
    expect(await expectDenied(db, "insert into feedback (rating) values (5)")).toBe("42501");
    expect(await expectDenied(db, "update feedback set rating = 1")).toBe("42501");
  });

  it("lets an admin read everything", async () => {
    await as(db, { uid: w.requester });
    await send({ likedNote: "one" });
    await as(db, { uid: w.otherUser });
    await send({ likedNote: "two" });
    await as(db, { uid: w.admin });
    expect(await count("select 1 from feedback")).toBe(2);
  });

  it("shows a verified team no more than any other signed-in person", async () => {
    await as(db, { uid: w.requester });
    await send({ likedNote: "one" });
    const teamOwner = await one<{ user_id: string }>(
      "select user_id from authority_units where id = $1",
      [w.yalaRescue],
    );
    await as(db, { uid: teamOwner.user_id });
    expect(await count("select 1 from feedback")).toBe(0);
  });
});

describe("the public page", () => {
  it("shows nothing until an admin approves it", async () => {
    await as(db, "anon");
    const sent = await send({ publicOk: true, likedNote: "it warned me in time" });
    expect(await count("select 1 from public_feedback()")).toBe(0);

    await as(db, { uid: w.admin });
    await db.query("select admin_feedback_publish($1, 'approved')", [sent.feedback_id]);
    await as(db, "anon");
    expect(await count("select 1 from public_feedback()")).toBe(1);

    // And an approved one can be taken back off the page.
    await as(db, { uid: w.admin });
    await db.query("select admin_feedback_publish($1, 'refused')", [sent.feedback_id]);
    await as(db, "anon");
    expect(await count("select 1 from public_feedback()")).toBe(0);
  });

  it("cannot be made to publish a comment its sender never offered", async () => {
    await as(db, "anon");
    const sent = await send({ publicOk: false, likedNote: "admins only" });
    await as(db, { uid: w.admin });
    expect(
      await expectDenied(db, "select admin_feedback_publish($1, 'approved')", [sent.feedback_id]),
    ).toBe("23514");
    // And a consent cannot be handed back on the sender's behalf either.
    expect(
      await expectDenied(db, "select admin_feedback_publish($1, 'not_requested')", [
        sent.feedback_id,
      ]),
    ).toBe("23514");
  });

  it("gives a visitor the display name, the two notes and the chips - and nothing else", async () => {
    await published({ anonymous: true, name: "Mali" });
    await as(db, "anon");
    const row = await one<Record<string, unknown>>("select * from public_feedback()");
    expect(Object.keys(row).sort()).toEqual(
      [
        "display_name",
        "id",
        "improve",
        "improve_note",
        "liked",
        "liked_note",
        "month",
        "rating",
      ].sort(),
    );
    expect(row.display_name).toBe("Mali");
    expect(row.improve).toEqual(["malay_incomplete"]);
    // The month, never the moment: the finest grain Jaga publishes is the area by month.
    expect(String(row.month)).toMatch(/^\d{4}-\d{2}$/);
  });

  it("is the only way a visitor reaches anybody else's row", async () => {
    await published({ anonymous: true, name: "Mali" });
    await as(db, "anon");
    expect(await count("select 1 from feedback")).toBe(0);
    expect(await expectDenied(db, "select * from admin_feedback()")).toBe("42501");
    expect(await expectDenied(db, "select admin_feedback_trends()")).toBe("42501");
    expect(await expectDenied(db, "select admin_feedback_export()")).toBe("42501");
  });

  it("publishes no average until the period has 20 answers", async () => {
    await as(db, "anon");
    for (let i = 0; i < 19; i += 1) await send({ rating: 5, deviceId: `phone-${i}` });
    await as(db, "anon");
    let figures = (
      await one<{ f: Record<string, unknown> }>("select public_feedback_figures() as f")
    ).f;
    expect(figures.answers).toBe(19);
    expect(figures.enough).toBe(false);
    expect(figures.average).toBeNull();
    expect(figures.liked).toEqual([]);

    await as(db, "anon");
    await send({ rating: 5, deviceId: "phone-20" });
    figures = (await one<{ f: Record<string, unknown> }>("select public_feedback_figures() as f")).f;
    expect(figures.answers).toBe(20);
    expect(figures.enough).toBe(true);
    expect(Number(figures.average)).toBe(5);
    expect((figures.liked as { code: string }[])[0]!.code).toBe("risk_map");
  });

  it("carries what was done about each weak point, in every language", async () => {
    await as(db, { uid: w.admin });
    await db.query(
      "select admin_feedback_outcome('malay_incomplete', $1, $2, $3, 'commit abc1234')",
      ["ทำแล้ว", "Sudah dibuat", "Done"],
    );
    await as(db, "anon");
    const outcome = await one<{ note: Record<string, string>; change_ref: string }>(
      "select note, change_ref from feedback_outcomes where code = 'malay_incomplete'",
    );
    expect(outcome.note.th).toBe("ทำแล้ว");
    expect(outcome.note.en).toBe("Done");
    expect(outcome.change_ref).toBe("commit abc1234");
    // ...and only an admin may write one.
    expect(
      await expectDenied(db, "select admin_feedback_outcome('late_warning', 'x', null, null, null)"),
    ).toBe("42501");
  });
});

describe("taking it back", () => {
  it("works for an anonymous sender with the key their phone kept", async () => {
    const sent = await published({ anonymous: true, name: "Mali" });
    await as(db, "anon");
    expect(await count("select 1 from public_feedback()")).toBe(1);
    // The wrong key tells them nothing and changes nothing.
    expect(
      await expectDenied(db, "select withdraw_feedback($1, $2)", [
        sent.feedback_id,
        "not-the-key-at-all-0000",
      ]),
    ).toBe("42501");
    expect(await count("select 1 from public_feedback()")).toBe(1);

    const gone = await one<{ withdraw_feedback: boolean }>(
      "select withdraw_feedback($1, $2)",
      [sent.feedback_id, sent.withdraw_key],
    );
    expect(gone.withdraw_feedback).toBe(true);
    expect(await count("select 1 from public_feedback()")).toBe(0);
    await asOwner(db);
    expect(await count("select 1 from feedback where id = $1", [sent.feedback_id])).toBe(0);
    expect(await auditCount("feedback_withdrawn", sent.feedback_id!)).toBe(1);
  });

  it("works for a signed-in sender with no key at all", async () => {
    const sent = await published({ anonymous: false, name: "Nok" });
    await as(db, { uid: w.requester });
    expect(
      (
        await one<{ withdraw_feedback: boolean }>("select withdraw_feedback($1, null)", [
          sent.feedback_id,
        ])
      ).withdraw_feedback,
    ).toBe(true);
    await as(db, "anon");
    expect(await count("select 1 from public_feedback()")).toBe(0);
  });

  it("refuses somebody else's, signed in or not", async () => {
    const sent = await published({ anonymous: false, name: "Nok" });
    await as(db, { uid: w.otherUser });
    expect(await expectDenied(db, "select withdraw_feedback($1, null)", [sent.feedback_id])).toBe(
      "42501",
    );
    await as(db, "anon");
    expect(await expectDenied(db, "select withdraw_feedback($1, null)", [sent.feedback_id])).toBe(
      "42501",
    );
  });

  it("tells a phone about its own row and nothing about anyone else's", async () => {
    const sent = await published({ anonymous: true, name: "Mali" });
    await as(db, "anon");
    const mine = await one<{ feedback_mine: Record<string, unknown> | null }>(
      "select feedback_mine($1, $2)",
      [sent.feedback_id, sent.withdraw_key],
    );
    expect(mine.feedback_mine?.publicStatus).toBe("approved");
    const notMine = await one<{ feedback_mine: unknown }>("select feedback_mine($1, $2)", [
      sent.feedback_id,
      "a-key-that-is-long-enough-but-wrong",
    ]);
    expect(notMine.feedback_mine).toBeNull();
  });
});

describe("the admin console", () => {
  it("lists everything but the contact, and logs every reveal of one", async () => {
    await as(db, { uid: w.requester });
    const sent = await send({
      contactOk: true,
      contact: "0812345678",
      likedNote: "good",
      district: w.yala1.slice(0, 4),
    });
    await as(db, { uid: w.admin });
    const row = await one<Record<string, unknown>>("select * from admin_feedback()");
    expect(row.has_contact).toBe(true);
    expect(Object.keys(row)).not.toContain("contact");
    expect(Object.keys(row)).not.toContain("device_id");
    expect(row.district_code).toBe(w.yala1.slice(0, 4));

    const shown = await one<{ feedback_contact: string }>("select feedback_contact($1)", [
      sent.feedback_id,
    ]);
    expect(shown.feedback_contact).toBe("0812345678");
    expect(await auditCount("reveal_feedback_contact", sent.feedback_id!)).toBe(1);

    // A visitor and an ordinary user never reach it.
    await as(db, "anon");
    expect(await expectDenied(db, "select feedback_contact($1)", [sent.feedback_id])).toBe("42501");
    await as(db, { uid: w.otherUser });
    expect(await expectDenied(db, "select feedback_contact($1)", [sent.feedback_id])).toBe("42501");
  });

  it("clears the contact the moment an item is closed", async () => {
    await as(db, { uid: w.requester });
    const sent = await send({ contactOk: true, contact: "0812345678" });
    await as(db, { uid: w.admin });
    await db.query("select admin_feedback_triage($1, 'planned', 'worth doing', null)", [
      sent.feedback_id,
    ]);
    await asOwner(db);
    expect(
      (await one<{ contact: string | null }>("select contact from feedback where id = $1", [
        sent.feedback_id,
      ])).contact,
    ).toBe("0812345678");

    await as(db, { uid: w.admin });
    await db.query("select admin_feedback_triage($1, 'done', null, 'commit abc1234')", [
      sent.feedback_id,
    ]);
    await asOwner(db);
    const after = await one<{
      contact: string | null;
      contact_ok: boolean;
      change_ref: string;
      admin_note: string;
    }>("select contact, contact_ok, change_ref, admin_note from feedback where id = $1", [
      sent.feedback_id,
    ]);
    expect(after.contact).toBeNull();
    expect(after.contact_ok).toBe(false);
    expect(after.change_ref).toBe("commit abc1234");
    // The earlier note is kept rather than wiped by a triage that did not carry one.
    expect(after.admin_note).toBe("worth doing");
  });

  it("refuses triage and the trends to anyone who is not an admin", async () => {
    await as(db, { uid: w.requester });
    const sent = await send();
    expect(
      await expectDenied(db, "select admin_feedback_triage($1, 'read', null, null)", [
        sent.feedback_id,
      ]),
    ).toBe("42501");
    expect(await expectDenied(db, "select admin_feedback_trends()")).toBe("42501");
    expect(
      await expectDenied(db, "select admin_feedback_publish($1, 'approved')", [sent.feedback_id]),
    ).toBe("42501");
  });

  it("exports without a contact, a device, an account or a case, and logs the export", async () => {
    await as(db, { uid: w.requester });
    await send({ contactOk: true, contact: "0812345678", sos: w.yalaSos });
    await as(db, { uid: w.admin });
    const exported = await one<{ admin_feedback_export: Record<string, unknown>[] }>(
      "select admin_feedback_export() as admin_feedback_export",
    );
    const row = exported.admin_feedback_export[0]!;
    expect(row.had_contact).toBe(true);
    for (const forbidden of ["contact", "device_id", "user_id", "sos_id"]) {
      expect(Object.keys(row)).not.toContain(forbidden);
    }
    expect(await auditCount("feedback_export", "csv")).toBe(1);
  });

  it("counts a hidden item out of the public figures but keeps it in the admins' own", async () => {
    await as(db, "anon");
    for (let i = 0; i < 20; i += 1) await send({ rating: 5, deviceId: `p-${i}` });
    const bad = await send({ rating: 1, deviceId: "p-bad" });
    await as(db, { uid: w.admin });
    await db.query("select admin_feedback_triage($1, 'hidden', 'abuse', null)", [bad.feedback_id]);
    const trends = (
      await one<{ t: Record<string, unknown> }>("select admin_feedback_trends() as t")
    ).t;
    expect(trends.answers).toBe(21);
    await as(db, "anon");
    const figures = (
      await one<{ f: Record<string, unknown> }>("select public_feedback_figures() as f")
    ).f;
    expect(figures.answers).toBe(20);
    expect(Number(figures.average)).toBe(5);
  });
});

describe("retention", () => {
  it("anonymises everything around an answer after 12 months", async () => {
    const sent = await published({ anonymous: true, name: "Mali" });
    const privateOne = await (async () => {
      await as(db, "anon");
      return send({ publicOk: false, likedNote: "admins only", deviceId: "device-b" });
    })();

    await asOwner(db);
    await db.query("update feedback set created_at = now() - interval '13 months'");
    await db.query("select feedback_retention()");

    const kept = await one<Record<string, unknown>>("select * from feedback where id = $1", [
      sent.feedback_id,
    ]);
    // What was consented to and already shown stays, and so does the way back to it.
    expect(kept.display_name).toBe("Mali");
    expect(kept.liked_note).toBe("it warned me before the water came");
    expect(kept.withdraw_key_hash).not.toBeNull();
    expect(kept.anonymised_at).not.toBeNull();
    // Everything around it goes.
    for (const gone of ["user_id", "device_id", "district_code", "role_at_time", "device_kind"]) {
      expect(kept[gone]).toBeNull();
    }
    // The figures survive: that is what ratings are kept as.
    expect(kept.rating).toBe(4);
    expect(kept.screen).toBe("/");
    expect(kept.locale).toBe("th");

    // A comment nobody consented to show loses its words too.
    const wiped = await one<Record<string, unknown>>("select * from feedback where id = $1", [
      privateOne.feedback_id,
    ]);
    expect(wiped.liked_note).toBeNull();
    expect(wiped.rating).toBe(4);
  });

  it("still lets a published anonymous comment be withdrawn after it has been anonymised", async () => {
    const sent = await published({ anonymous: true, name: "Mali" });
    await asOwner(db);
    await db.query("update feedback set created_at = now() - interval '13 months'");
    await db.query("select feedback_retention()");
    await as(db, "anon");
    expect(
      (
        await one<{ withdraw_feedback: boolean }>("select withdraw_feedback($1, $2)", [
          sent.feedback_id,
          sent.withdraw_key,
        ])
      ).withdraw_feedback,
    ).toBe(true);
  });
});

describe("in LINE", () => {
  it("stores a rating against the account behind the LINE id, and respects the daily limit", async () => {
    await asOwner(db);
    const token = (
      await rows<{ token: string }>(
        db,
        "select value ->> 'token' as token from system_settings where key = 'push_gate'",
      )
    )[0]?.token;
    if (!token) return; // No push gate set up on this database: nothing to test against.
    const liner = await createUser(db, { name: "line person" });
    await db.query(
      "update profiles set line_user_id = 'U-line-1', preferred_locale = 'ms', home_tambon = $2 where user_id = $1",
      [liner, w.yala1],
    );

    await as(db, "anon");
    for (let i = 0; i < 3; i += 1) {
      expect(
        (
          await one<{ line_feedback: boolean }>(
            "select line_feedback($1, 'U-line-1', $2::smallint, null)",
            [token, 4],
          )
        ).line_feedback,
      ).toBe(true);
    }
    expect(
      (
        await one<{ line_feedback: boolean }>(
          "select line_feedback($1, 'U-line-1', $2::smallint, null)",
          [token, 4],
        )
      ).line_feedback,
    ).toBe(false);

    await asOwner(db);
    const row = await one<Record<string, unknown>>(
      "select * from feedback where screen = 'line' order by created_at limit 1",
    );
    expect(row.user_id).toBe(liner);
    expect(row.moment).toBe("line");
    expect(row.locale).toBe("ms");
    // Never offered for the page: a rating sent in a chat carries no consent to be shown.
    expect(row.public_ok).toBe(false);
    expect(row.public_status).toBe("not_requested");
    // The district only, never the tambon.
    expect(row.district_code).toBe(w.yala1.slice(0, 4));

    // And nobody without the gate's token may write through it.
    await as(db, "anon");
    expect(
      await expectDenied(db, "select line_feedback('wrong-token', 'U-line-1', 4::smallint, null)"),
    ).toBe("42501");
  });
});
