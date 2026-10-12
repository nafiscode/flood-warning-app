/**
 * A5: what admins may do about points and households.
 *
 * What these tests are really guarding:
 *  - an award can be taken back only by an admin, only with a reason, only once, and it then
 *    stops counting everywhere while staying in the ledger;
 *  - an admin's read of the households is logged like a team's and carries no phone number.
 */
import type { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { as, asOwner, connect, expectDenied, rows } from "./db";
import { buildWorld, type World } from "./fixtures";

let db: Client;
let w: World;
let award = 0;

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
  award = Number(
    (
      await rows<{ id: string }>(
        db,
        "insert into hero_points (unit_id, sos_id, points, reason) values ($1, $2, 14, 'rescue confirmed: requester') returning id",
        [w.yalaRescue.id, w.yalaSos],
      )
    )[0]!.id,
  );
});
afterEach(async () => {
  await db.query("rollback");
});

describe("taking points back", () => {
  it("is an admin's to do, and needs a reason", async () => {
    await as(db, { uid: w.yalaRescue.user });
    await expectDenied(db, "select admin_revoke_points($1, 'not mine to give')", [award]);
    await as(db, { uid: w.admin });
    await expectDenied(db, "select admin_revoke_points($1, '   ')", [award]);
  });

  it("keeps the row in the ledger, with who and why, and stops it counting", async () => {
    await as(db, { uid: w.admin });
    await db.query("select admin_revoke_points($1, 'duplicate case')", [award]);

    const ledger = await rows<{ revoked_at: Date | null; revoke_reason: string; points: number }>(
      db,
      "select revoked_at, revoke_reason, points from admin_points_ledger(50) where award_id = $1",
      [award],
    );
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.revoked_at).toBeInstanceOf(Date);
    expect(ledger[0]!.revoke_reason).toBe("duplicate case");
    expect(ledger[0]!.points).toBe(14);

    // The teams' own board no longer counts it.
    await as(db, { uid: w.yalaRescue.user });
    const board = await rows(db, "select 1 from hero_leaderboard(null) where unit_id = $1", [
      w.yalaRescue.id,
    ]);
    expect(board).toHaveLength(0);

    await asOwner(db);
    const log = await rows(
      db,
      "select 1 from audit_log where action = 'revoke_points' and entity_id = $1 and actor = $2",
      [String(award), w.admin],
    );
    expect(log).toHaveLength(1);
  });

  it("cannot be done twice", async () => {
    await as(db, { uid: w.admin });
    await db.query("select admin_revoke_points($1, 'duplicate case')", [award]);
    await expectDenied(db, "select admin_revoke_points($1, 'again')", [award]);
  });

  it("the ledger is closed to everyone but admins", async () => {
    await as(db, { uid: w.yalaRescue.user });
    await expectDenied(db, "select * from admin_points_ledger(50)");
    await as(db, "anon");
    await expectDenied(db, "select * from admin_points_ledger(50)");
  });
});

describe("households, for admins", () => {
  it("are listed without a phone number, and the read is logged", async () => {
    await as(db, { uid: w.admin });
    const list = await rows<Record<string, unknown>>(db, "select * from admin_households()");
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(Object.keys(list[0]!).some((k) => /phone$/.test(k) && k !== "has_phone")).toBe(false);
    await asOwner(db);
    const log = await rows(
      db,
      "select 1 from audit_log where action = 'read_households' and entity = 'households' and actor = $1",
      [w.admin],
    );
    expect(log).toHaveLength(1);
  });

  it("are closed to a team and to an ordinary account through this door", async () => {
    await as(db, { uid: w.yalaRescue.user });
    await expectDenied(db, "select * from admin_households()");
    await as(db, { uid: w.otherUser });
    await expectDenied(db, "select * from admin_households()");
  });
});
