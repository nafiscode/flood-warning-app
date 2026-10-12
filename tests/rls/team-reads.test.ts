/**
 * A5: what a team reads besides its cases (spec 5.7) - flood reports and households.
 *
 * What these tests are really guarding:
 *  - household data reaches only a verified team that covers the tambon AND has the rescue or
 *    coordination capability; a planning team, a team elsewhere and an ordinary account get
 *    nothing (spec 4.7, safety rule 5);
 *  - the list never carries a phone number, and both the read and the reveal are in audit_log;
 *  - a report an admin hid is not passed on, and no reporter is named.
 */
import type { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { as, asOwner, connect, expectDenied, rows } from "./db";
import { buildWorld, type World } from "./fixtures";

let db: Client;
let w: World;
let household = "";
let report = "";

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
  household = (
    await rows<{ id: string }>(
      db,
      `insert into households (owner_id, point, size, vulnerable, mobility_notes, contact_phone, consent_at)
       values ($1, extensions.st_geomfromtext($2, 4326), 4,
               '{"elderly": 1, "bedridden": 1}'::jsonb, 'Second floor, cannot use stairs',
               '+66812223333', now())
       returning id`,
      // The fixture's requester already has a household of their own; this one is another person's.
      [w.otherUser, w.yalaPoint],
    )
  )[0]!.id;
  report = (
    await rows<{ id: string }>(
      db,
      `insert into reports (reporter_id, point, depth_ref, trend, road_access, text, moderation_status)
       values ($1, extensions.st_geomfromtext($2, 4326), 'knee', 'rising', 'motorbike_only',
               'water over the road', 'pending')
       returning id`,
      [w.requester, w.yalaPoint],
    )
  )[0]!.id;
});
afterEach(async () => {
  await db.query("rollback");
});

describe("households, for teams", () => {
  it("reach a rescue team covering the tambon, without the phone number", async () => {
    await as(db, { uid: w.yalaRescue.user });
    const list = await rows<Record<string, unknown>>(db, "select * from authority_households()");
    const mine = list.find((h) => h.household_id === household)!;
    expect(mine.size).toBe(4);
    expect(mine.vulnerable).toEqual({ elderly: 1, bedridden: 1 });
    expect(mine.has_phone).toBe(true);
    expect(JSON.stringify(list)).not.toContain("812223333");
    expect(Object.keys(mine).some((k) => /phone$/.test(k) && k !== "has_phone")).toBe(false);
  });

  it("write every read to the access log, with how many households it showed", async () => {
    await as(db, { uid: w.yalaRescue.user });
    await db.query("select * from authority_households()");
    await asOwner(db);
    const log = await rows<{ details: { count: number } }>(
      db,
      "select details from audit_log where actor = $1 and action = 'read_households'",
      [w.yalaRescue.user],
    );
    expect(log).toHaveLength(1);
    expect(log[0]!.details.count).toBeGreaterThanOrEqual(1);
  });

  it("are closed to a team without rescue or coordination capability", async () => {
    await as(db, { uid: w.yalaPlanning.user });
    await expectDenied(db, "select * from authority_households()");
    await expectDenied(db, "select reveal_household_phone($1)", [household]);
  });

  it("are not shown to a team that covers somewhere else", async () => {
    await as(db, { uid: w.songkhlaRescue.user });
    const list = await rows<{ household_id: string }>(db, "select * from authority_households()");
    expect(list.some((h) => h.household_id === household)).toBe(false);
    await expectDenied(db, "select reveal_household_phone($1)", [household]);
  });

  it("are closed to an unverified team, an ordinary account and a visitor", async () => {
    await as(db, { uid: w.yalaPending.user });
    await expectDenied(db, "select * from authority_households()");
    await as(db, { uid: w.otherUser });
    await expectDenied(db, "select * from authority_households()");
    await as(db, "anon");
    await expectDenied(db, "select * from authority_households()");
  });

  it("give the phone number one household at a time, and log the look", async () => {
    await as(db, { uid: w.yalaRescue.user });
    const got = await rows<{ reveal_household_phone: string }>(
      db,
      "select reveal_household_phone($1)",
      [household],
    );
    expect(got[0]!.reveal_household_phone).toBe("+66812223333");
    await asOwner(db);
    const log = await rows(
      db,
      "select 1 from audit_log where actor = $1 and action = 'reveal_phone' and entity = 'households' and entity_id = $2",
      [w.yalaRescue.user, household],
    );
    expect(log).toHaveLength(1);
  });

  it("stay the owner's own to change and to delete", async () => {
    await as(db, { uid: w.otherUser });
    await db.query("update households set size = 5 where id = $1", [household]);
    await as(db, { uid: w.requester });
    const touched = await db.query("update households set size = 9 where id = $1", [household]);
    expect(touched.rowCount).toBe(0);
    await as(db, { uid: w.otherUser });
    const gone = await db.query("delete from households where id = $1", [household]);
    expect(gone.rowCount).toBe(1);
  });
});

describe("flood reports, for teams", () => {
  type Row = Record<string, unknown>;

  it("reach a team covering the tambon, with what the water is doing and no reporter", async () => {
    await as(db, { uid: w.yalaRescue.user });
    const list = await rows<Row>(db, "select * from authority_reports(72)");
    const mine = list.find((r) => r.report_id === report)!;
    expect(mine.depth_ref).toBe("knee");
    expect(mine.trend).toBe("rising");
    expect(mine.road_access).toBe("motorbike_only");
    expect(Object.keys(mine).some((k) => /reporter|user|phone/.test(k))).toBe(false);
    expect(JSON.stringify(list)).not.toContain(w.requester);
  });

  it("do not pass on a report an admin hid", async () => {
    await asOwner(db);
    await db.query("update reports set moderation_status = 'hidden' where id = $1", [report]);
    await as(db, { uid: w.yalaRescue.user });
    const list = await rows<Row>(db, "select * from authority_reports(72)");
    expect(list.some((r) => r.report_id === report)).toBe(false);
  });

  it("are not shown to a team elsewhere, and are closed to everyone else", async () => {
    await as(db, { uid: w.songkhlaRescue.user });
    const list = await rows<Row>(db, "select * from authority_reports(72)");
    expect(list.some((r) => r.report_id === report)).toBe(false);
    await as(db, { uid: w.otherUser });
    await expectDenied(db, "select * from authority_reports(72)");
    await as(db, "anon");
    await expectDenied(db, "select * from authority_reports(72)");
  });
});
