/**
 * A5: points for teams (spec 5.5), the responsibility map (5.6) and the admins' list of rescues
 * waiting for a confirmation (5.4).
 *
 * What these tests are really guarding:
 *  - points exist only after a confirmation, never for accepting or for reporting;
 *  - a team cannot earn them from a request its own account sent, and a typed-in head count
 *    cannot run away;
 *  - the responsibility map tells a verified team where the gaps are and tells nobody else
 *    anything.
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

type Points = { unit_id: string; points: number; reason: string };
const points = async () => {
  await asOwner(db);
  return rows<Points>(
    db,
    "select unit_id, points, reason from hero_points where sos_id = $1 and revoked_at is null",
    [w.yalaSos],
  );
};

async function reportRescue() {
  await asOwner(db);
  const path = `${w.yalaSos}/proof/a.jpg`;
  await db.query("insert into storage.objects (bucket_id, name) values ('sos-media', $1)", [path]);
  await as(db, { uid: w.yalaRescue.user });
  await db.query("select * from authority_accept_sos($1)", [w.yalaSos]);
  await db.query("select authority_complete_sos($1, $2, null)", [w.yalaSos, [path]]);
}

async function confirmAsRequester() {
  await as(db, { uid: w.requester });
  await db.query("select sos_close($1, null, true, null)", [w.yalaSos]);
}

describe("points", () => {
  it("are not given for accepting, nor for reporting a rescue", async () => {
    await reportRescue();
    expect(await points()).toHaveLength(0);
  });

  it("are given to the team once the person confirms: 10 for the case and 2 a person", async () => {
    await asOwner(db);
    await db.query(
      "update sos_requests set people_count = 3, vulnerable_flags = '{}'::jsonb where id = $1",
      [w.yalaSos],
    );
    await reportRescue();
    await confirmAsRequester();
    const got = await points();
    expect(got).toHaveLength(1);
    expect(got[0]!.unit_id).toBe(w.yalaRescue.id);
    expect(got[0]!.points).toBe(16);
  });

  it("add the bonus when vulnerable people were involved, and count one person when none was said", async () => {
    await asOwner(db);
    await db.query(
      `update sos_requests set people_count = null, vulnerable_flags = '{"elderly": true}'::jsonb
        where id = $1`,
      [w.yalaSos],
    );
    await reportRescue();
    await confirmAsRequester();
    expect((await points())[0]!.points).toBe(15);
  });

  it("cap the head count, so a typed-in number cannot run away", async () => {
    await asOwner(db);
    await db.query(
      "update sos_requests set people_count = 500, vulnerable_flags = '{}'::jsonb where id = $1",
      [w.yalaSos],
    );
    await reportRescue();
    await confirmAsRequester();
    expect((await points())[0]!.points).toBe(50);
  });

  it("are not given for a request the team's own account sent", async () => {
    await asOwner(db);
    await db.query("update sos_requests set requester_id = $2 where id = $1", [
      w.yalaSos,
      w.yalaRescue.user,
    ]);
    await reportRescue();
    await as(db, { uid: w.yalaRescue.user });
    await db.query("select sos_close($1, null, true, null)", [w.yalaSos]);
    expect(await points()).toHaveLength(0);
  });

  it("are not given when nobody held the case", async () => {
    await confirmAsRequester();
    expect(await points()).toHaveLength(0);
  });

  it("show on the board of thanks for teams and admins, and for nobody else", async () => {
    await reportRescue();
    await confirmAsRequester();
    await as(db, { uid: w.yalaRescue.user });
    const board = await rows<{ unit_id: string; points: number; cases: number; is_mine: boolean }>(
      db,
      "select unit_id, points, cases, is_mine from hero_leaderboard('95') where unit_id = $1",
      [w.yalaRescue.id],
    );
    expect(board).toHaveLength(1);
    expect(board[0]!.cases).toBe(1);
    expect(board[0]!.is_mine).toBe(true);
    await as(db, { uid: w.otherUser });
    await expectDenied(db, "select * from hero_leaderboard(null)");
    await as(db, "anon");
    await expectDenied(db, "select * from hero_leaderboard(null)");
  });
});

describe("the responsibility map", () => {
  type Row = { tambon: string; rescue_units: number; mine: boolean };

  it("counts the rescue teams covering a tambon and marks the caller's own", async () => {
    await as(db, { uid: w.yalaRescue.user });
    const before = (
      await rows<Row>(
        db,
        "select tambon, rescue_units, mine from coverage_summary() where tambon = $1",
        [w.yala1],
      )
    )[0]!;
    expect(before.rescue_units).toBeGreaterThanOrEqual(1);
    expect(before.mine).toBe(true);
  });

  it("stops counting a team that is no longer verified, which is how a gap appears", async () => {
    await as(db, { uid: w.yalaRescue.user });
    const count = async () =>
      (
        await rows<Row>(
          db,
          "select tambon, rescue_units, mine from coverage_summary() where tambon = $1",
          [w.yala1],
        )
      )[0]!.rescue_units;
    const before = await count();
    await asOwner(db);
    await db.query("update authority_units set status = 'suspended' where id = $1", [
      w.yalaRescue.id,
    ]);
    await as(db, { uid: w.admin });
    expect(await count()).toBe(before - 1);
  });

  it("names the teams in a tambon without any phone number", async () => {
    await as(db, { uid: w.yalaRescue.user });
    const units = await rows<Record<string, unknown>>(db, "select * from coverage_units($1)", [
      w.yala1,
    ]);
    expect(units.some((u) => u.unit_id === w.yalaRescue.id && u.is_mine === true)).toBe(true);
    expect(JSON.stringify(units)).not.toMatch(/668\d{8}/);
    expect(Object.keys(units[0]!).some((k) => /phone/.test(k))).toBe(false);
  });

  it("is closed to ordinary accounts and visitors", async () => {
    await as(db, { uid: w.otherUser });
    await expectDenied(db, "select * from coverage_summary()");
    await expectDenied(db, "select * from coverage_units($1)", [w.yala1]);
    await as(db, "anon");
    await expectDenied(db, "select * from coverage_summary()");
  });
});

describe("rescues waiting for a confirmation, for the admins", () => {
  it("lists a reported rescue, and says when the person's time is up", async () => {
    await reportRescue();
    await as(db, { uid: w.admin });
    const fresh = await rows<{ due: boolean; proof_count: number }>(
      db,
      "select due, proof_count from admin_unconfirmed_rescues() where sos_id = $1",
      [w.yalaSos],
    );
    expect(fresh).toHaveLength(1);
    expect(fresh[0]!.due).toBe(false);
    expect(fresh[0]!.proof_count).toBe(1);

    await asOwner(db);
    await db.query(
      "update sos_claims set completed_at = now() - interval '13 hours' where sos_id = $1 and released_at is null",
      [w.yalaSos],
    );
    await as(db, { uid: w.admin });
    const late = await rows<{ due: boolean }>(
      db,
      "select due from admin_unconfirmed_rescues() where sos_id = $1",
      [w.yalaSos],
    );
    expect(late[0]!.due).toBe(true);
  });

  it("drops it once it is confirmed, and is closed to everyone but admins", async () => {
    await reportRescue();
    await confirmAsRequester();
    await as(db, { uid: w.admin });
    expect(
      await rows(db, "select 1 from admin_unconfirmed_rescues() where sos_id = $1", [w.yalaSos]),
    ).toHaveLength(0);
    await as(db, { uid: w.yalaRescue.user });
    await expectDenied(db, "select * from admin_unconfirmed_rescues()");
  });
});
