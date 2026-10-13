/**
 * Rescues a team found by itself (the owner, 13-14 Oct).
 *
 * What these tests are really guarding:
 *  - only a verified team records one, and only with all three proofs: a position taken now, a
 *    phone number for the rescued person, a photo that really was uploaded;
 *  - it is worth half an SOS rescue, never as much;
 *  - it counts at once only where there is reason to expect a flood and nothing looks repeated;
 *    everything else waits for an admin;
 *  - an admin can approve, refuse with a reason, and take back one that was counted;
 *  - the rescued person's number is readable by nobody directly, and an admin's look is logged;
 *  - another team, a resident and a visitor see none of it.
 */
import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { as, asOwner, connect, expectDenied, rows } from "./db";
import { buildWorld, type World } from "./fixtures";

let db: Client;
let w: World;
let spot: { lat: number; lon: number };

type Result = { status: string; holds: string[]; evidence: string[]; points: number };

async function photo(unit: string, rescue: string): Promise<string> {
  await asOwner(db);
  const path = `${unit}/${rescue}/1.jpg`;
  await db.query("insert into storage.objects (bucket_id, name) values ('field-media', $1)", [
    path,
  ]);
  return path;
}

async function record(
  over: {
    lat?: number;
    lon?: number;
    accuracy?: number | null;
    people?: number;
    vulnerable?: Record<string, boolean>;
    phone?: string;
  } = {},
): Promise<Result & { id: string }> {
  const id = randomUUID();
  const photos = [await photo(w.yalaRescue.id, id)];
  await as(db, { uid: w.yalaRescue.user });
  const [r] = await rows<Result>(
    db,
    `select * from authority_record_field_rescue($1, $2, $3, $4, now() - interval '1 minute',
                                                 $5, $6::jsonb, $7, $8, null)`,
    [
      id,
      over.lat ?? spot.lat,
      over.lon ?? spot.lon,
      over.accuracy === undefined ? 25 : over.accuracy,
      over.people ?? 3,
      JSON.stringify(over.vulnerable ?? {}),
      over.phone ?? `08${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`,
      photos,
    ],
  );
  return { ...r!, id };
}

beforeAll(async () => {
  db = await connect();
});
afterAll(async () => {
  await db?.end();
});
beforeEach(async () => {
  await db.query("begin");
  w = await buildWorld(db);
  await asOwner(db);
  // A quiet second tambon the team also covers: no alert, no report, no request for help, and
  // not flood-prone on the hazard map. Evidence is then whatever a test adds.
  [spot] = (await rows<{ lat: number; lon: number }>(
    db,
    "select extensions.st_y(p) as lat, extensions.st_x(p) as lon from (select extensions.st_pointonsurface(geom) p from tambons where code = $1) x",
    [w.yala2],
  )) as [{ lat: number; lon: number }];
  await db.query(
    "insert into authority_coverage (unit_id, tambon, selected_level, selected_code) values ($1, $2, 'tambon', $2)",
    [w.yalaRescue.id, w.yala2],
  );
  await db.query("delete from alerts");
  await db.query("delete from reports where tambon = $1", [w.yala2]);
  await db.query("delete from field_rescues");
  await db.query(
    "delete from sos_requests s where extensions.st_dwithin(s.point::extensions.geography, extensions.st_setsrid(extensions.st_makepoint($2, $1), 4326)::extensions.geography, 3000)",
    [spot.lat, spot.lon],
  );
  await db.query(
    "update hazard_by_tambon set high_pct = 0, medium_pct = 0, low_pct = 0 where tambon_code = $1",
    [w.yala2],
  );
});
afterEach(async () => {
  await db.query("rollback");
});

const floodReportHere = () =>
  db.query(
    `insert into reports (reporter_id, point, tambon, depth_ref)
     values ($1, extensions.st_setsrid(extensions.st_makepoint($3, $2), 4326), $4, 'waist')`,
    [w.otherUser, spot.lat, spot.lon, w.yala2],
  );

describe("who may record, and with what", () => {
  it("is refused to a visitor, a resident and a team that is not verified", async () => {
    const id = randomUUID();
    const call = `select * from authority_record_field_rescue($1, $2, $3, 20, now(), 2, '{}'::jsonb, '0812345678', $4, null)`;
    for (const caller of ["anon", { uid: w.requester }, { uid: w.yalaPending.user }] as const) {
      await as(db, caller);
      await expectDenied(db, call, [id, spot.lat, spot.lon, [`x/${id}/1.jpg`]]);
    }
  });

  it("needs all three proofs: a position taken now, a phone number, a photo that exists", async () => {
    await asOwner(db);
    await floodReportHere();
    const id = randomUUID();
    const path = await photo(w.yalaRescue.id, id);
    await as(db, { uid: w.yalaRescue.user });
    const refused = (
      phone: string | null,
      photos: string[],
      minutes: number,
      lat: number | null = spot.lat,
    ) =>
      expectDenied(
        db,
        `select * from authority_record_field_rescue($1, $2, $3, 20, now() - make_interval(mins => $4), 2, '{}'::jsonb, $5, $6, null)`,
        [id, lat, spot.lon, minutes, phone, photos],
      );
    await refused(null, [path], 1);
    await refused("12", [path], 1);
    await refused("0812345678", [], 1);
    // A path that was never uploaded, and a photo filed under another team.
    await refused("0812345678", [`${w.yalaRescue.id}/${id}/never.jpg`], 1);
    await refused("0812345678", [`${w.songkhlaRescue.id}/${id}/1.jpg`], 1);
    // Recorded later from somewhere else is not "at the moment".
    await refused("0812345678", [path], 45);
    await refused("0812345678", [path], 1, null);
  });

  it("refuses a place outside the provinces Jaga covers", async () => {
    const id = randomUUID();
    const path = await photo(w.yalaRescue.id, id);
    await as(db, { uid: w.yalaRescue.user });
    await expectDenied(
      db,
      `select * from authority_record_field_rescue($1, 13.75, 100.5, 20, now(), 2, '{}'::jsonb, '0812345678', $2, null)`,
      [id, [path]],
    );
  });
});

describe("counted at once, or held for an admin", () => {
  it("counts at once where a flood was reported nearby, for half the points of an SOS rescue", async () => {
    await asOwner(db);
    await floodReportHere();
    const r = await record({ people: 3, vulnerable: { elderly: true } });
    expect(r.status).toBe("counted");
    expect(r.holds).toEqual([]);
    expect(r.evidence).toContain("flood_report_near");
    // An SOS rescue of three people with someone vulnerable is 10 + 3 x 2 + 3 = 19; half is 9.
    expect(r.points).toBe(9);

    await asOwner(db);
    const [award] = await rows<{ points: number; unit_id: string; sos_id: string | null }>(
      db,
      "select points, unit_id, sos_id from hero_points where field_rescue_id = $1",
      [r.id],
    );
    expect(award).toEqual({ points: 9, unit_id: w.yalaRescue.id, sos_id: null });
  });

  it("is never worth as much as an SOS rescue, even if the setting is turned up", async () => {
    await asOwner(db);
    await floodReportHere();
    await db.query(
      `update system_settings set value = value || '{"points_percent": 300}'::jsonb where key = 'field_rescues'`,
    );
    const r = await record({ people: 1 });
    expect(r.points).toBeLessThan(12);
  });

  it("counts where the hazard map calls the tambon flood-prone", async () => {
    await asOwner(db);
    await db.query("update hazard_by_tambon set medium_pct = 35 where tambon_code = $1", [w.yala2]);
    const prone = await record();
    expect(prone.status).toBe("counted");
    expect(prone.evidence).toEqual(["flood_prone_area"]);
  });

  it("is held when nothing says there was a flood there, and earns nothing until approved", async () => {
    const r = await record();
    expect(r.status).toBe("pending");
    expect(r.holds).toEqual(["no_flood_evidence"]);
    expect(r.points).toBe(0);
    await asOwner(db);
    expect(await rows(db, "select 1 from hero_points where field_rescue_id = $1", [r.id])).toEqual(
      [],
    );
  });

  it("is held when it looks repeated: the same spot again, or the same phone number", async () => {
    await asOwner(db);
    await floodReportHere();
    const first = await record({ phone: "0811112222" });
    expect(first.status).toBe("counted");
    const again = await record({ lat: spot.lat + 0.0005 });
    expect(again.status).toBe("pending");
    expect(again.holds).toContain("repeat_nearby");
    const samePhone = await record({ lat: spot.lat + 0.01, phone: "081-111-2222" });
    expect(samePhone.holds).toContain("phone_used_before");
  });

  it("is held when the team has recorded many in a day", async () => {
    await asOwner(db);
    await floodReportHere();
    await db.query(
      `update system_settings set value = value || '{"daily_cap": 2, "repeat_m": 1}'::jsonb where key = 'field_rescues'`,
    );
    expect((await record({ lat: spot.lat + 0.001 })).status).toBe("counted");
    expect((await record({ lat: spot.lat + 0.002 })).status).toBe("counted");
    const third = await record({ lat: spot.lat + 0.003 });
    expect(third.holds).toEqual(["many_today"]);
  });

  it("is held with a vague position, outside the team's area, or beside an open request", async () => {
    await asOwner(db);
    await floodReportHere();
    expect((await record({ accuracy: 900 })).holds).toContain("vague_position");
    expect((await record({ accuracy: null, lat: spot.lat + 0.005 })).holds).toContain(
      "vague_position",
    );

    await asOwner(db);
    await db.query(
      `insert into sos_requests (point, tambon, people_count)
       values (extensions.st_setsrid(extensions.st_makepoint($2, $1), 4326), $3, 2)`,
      [spot.lat + 0.008, spot.lon, w.yala2],
    );
    const beside = await record({ lat: spot.lat + 0.008 });
    expect(beside.holds).toContain("open_request_here");
    expect(beside.evidence).toContain("sos_near");

    await asOwner(db);
    await db.query("delete from authority_coverage where unit_id = $1 and tambon = $2", [
      w.yalaRescue.id,
      w.yala2,
    ]);
    expect((await record({ lat: spot.lat - 0.005 })).holds).toContain("outside_coverage");
  });
});

describe("the admins' decision", () => {
  it("approving a held record awards the half points; refusing needs a reason", async () => {
    const r = await record({ people: 2 });
    await as(db, { uid: w.yalaRescue.user });
    await expectDenied(db, "select admin_review_field_rescue($1, true, null)", [r.id]);

    await as(db, { uid: w.admin });
    const [held] = await rows<{ rescue_id: string; checks: { holds: string[] } }>(
      db,
      "select rescue_id, checks from admin_field_rescues('pending') where rescue_id = $1",
      [r.id],
    );
    expect(held!.checks.holds).toEqual(["no_flood_evidence"]);
    await expectDenied(db, "select admin_review_field_rescue($1, false, '  ')", [r.id]);
    await db.query("select admin_review_field_rescue($1, true, 'called the number')", [r.id]);
    await expectDenied(db, "select admin_review_field_rescue($1, true, null)", [r.id]);

    await asOwner(db);
    const [award] = await rows<{ points: number }>(
      db,
      "select points from hero_points where field_rescue_id = $1 and revoked_at is null",
      [r.id],
    );
    // 10 + 2 x 2 = 14; half is 7.
    expect(award!.points).toBe(7);
    expect(
      await rows(
        db,
        "select 1 from audit_log where action = 'field_rescue_reviewed' and entity_id = $1 and actor = $2",
        [r.id, w.admin],
      ),
    ).toHaveLength(1);
  });

  it("refusing one that was counted takes its points back, and it leaves the board", async () => {
    await asOwner(db);
    await floodReportHere();
    const r = await record();
    await as(db, { uid: w.yalaRescue.user });
    const before = await rows<{ points: number; cases: number }>(
      db,
      "select points, cases from hero_leaderboard(null) where unit_id = $1",
      [w.yalaRescue.id],
    );
    expect(before[0]).toMatchObject({ points: 8, cases: 1 });

    await as(db, { uid: w.admin });
    await db.query("select admin_review_field_rescue($1, false, 'photo shows another place')", [
      r.id,
    ]);
    await as(db, { uid: w.yalaRescue.user });
    expect(
      await rows(db, "select 1 from hero_leaderboard(null) where unit_id = $1", [w.yalaRescue.id]),
    ).toEqual([]);
    const [mine] = await rows<{ status: string; points: number; review_note: string }>(
      db,
      "select status, points, review_note from my_field_rescues() where rescue_id = $1",
      [r.id],
    );
    expect(mine).toEqual({
      status: "rejected",
      points: 0,
      review_note: "photo shows another place",
    });
  });
});

describe("who can see what", () => {
  it("shows a record to its own team and to admins, and to nobody else", async () => {
    await asOwner(db);
    await floodReportHere();
    const r = await record();
    await as(db, "anon");
    await expectDenied(db, "select 1 from field_rescues where id = $1", [r.id]);
    for (const caller of [{ uid: w.requester }, { uid: w.songkhlaRescue.user }] as const) {
      await as(db, caller);
      expect(await rows(db, "select 1 from field_rescues where id = $1", [r.id])).toEqual([]);
      expect(await rows(db, "select 1 from my_field_rescues()")).toEqual([]);
      await expectDenied(db, "select * from admin_field_rescues('counted')");
    }
    await as(db, { uid: w.yalaRescue.user });
    expect(await rows(db, "select 1 from field_rescues where id = $1", [r.id])).toHaveLength(1);
  });

  it("keeps the rescued person's number from every client; an admin's look is logged", async () => {
    await asOwner(db);
    await floodReportHere();
    const r = await record({ phone: "0898765432" });
    for (const caller of [{ uid: w.yalaRescue.user }, { uid: w.admin }] as const) {
      await as(db, caller);
      await expectDenied(db, "select 1 from field_rescue_contacts");
    }
    await as(db, { uid: w.yalaRescue.user });
    await expectDenied(db, "select reveal_field_rescue_phone($1)", [r.id]);
    const mine = await rows<Record<string, unknown>>(db, "select * from my_field_rescues()");
    expect(JSON.stringify(mine)).not.toContain("0898765432");

    await as(db, { uid: w.admin });
    const [seen] = await rows<{ phone: string }>(
      db,
      "select reveal_field_rescue_phone($1) as phone",
      [r.id],
    );
    expect(seen!.phone).toBe("0898765432");
    const listed = await rows<Record<string, unknown>>(
      db,
      "select * from admin_field_rescues('counted')",
    );
    expect(JSON.stringify(listed)).not.toContain("0898765432");
    await asOwner(db);
    expect(
      await rows(
        db,
        "select 1 from audit_log where action = 'reveal_phone' and entity = 'field_rescues' and entity_id = $1 and actor = $2",
        [r.id, w.admin],
      ),
    ).toHaveLength(1);
  });

  it("lets a team file photos only under its own unit, and only once verified", async () => {
    const writable = async (uid: string, unit: string) => {
      await as(db, { uid });
      const [r] = await rows<{ ok: boolean }>(db, "select field_media_writable($1) as ok", [
        `${unit}/x/1.jpg`,
      ]);
      return r!.ok;
    };
    expect(await writable(w.yalaRescue.user, w.yalaRescue.id)).toBe(true);
    expect(await writable(w.yalaRescue.user, w.songkhlaRescue.id)).toBe(false);
    expect(await writable(w.yalaPending.user, w.yalaPending.id)).toBe(false);
  });
});
