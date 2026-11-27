/**
 * The "Team coverage" switch on the main map, for everyone (owner, 27 Nov 2026).
 *
 * `coverage_summary()` stays closed to verified teams and admins (points.test.ts guards that). This
 * is its public cut, and what these tests really guard is how little it says: a yes or a no per
 * tambon, never how many teams, which ones, or whether the caller is one of them (safety rules 5
 * and 6), and never a tambon "covered" because a unit that is not a rescue team sits on it.
 */
import type { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { as, asOwner, connect, rows } from "./db";
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

type Row = { tambon: string; province_code: string; covered: boolean };
const covered = async (tambon: string) =>
  (await rows<Row>(db, "select * from public_team_coverage() where tambon = $1", [tambon]))[0]!
    .covered;

describe("public team coverage", () => {
  it("is open to a visitor and to any signed-in account", async () => {
    await as(db, "anon");
    expect((await rows<Row>(db, "select * from public_team_coverage()")).length).toBeGreaterThan(0);
    await as(db, { uid: w.otherUser });
    expect((await rows<Row>(db, "select * from public_team_coverage()")).length).toBeGreaterThan(0);
  });

  it("says only whether a tambon is covered: no counts, no unit, no 'mine'", async () => {
    await as(db, "anon");
    const [first] = await rows<Row>(db, "select * from public_team_coverage() limit 1");
    expect(Object.keys(first!).sort()).toEqual(["covered", "province_code", "tambon"]);
  });

  it("calls a tambon covered while a verified rescue team covers it", async () => {
    await as(db, "anon");
    expect(await covered(w.yala1)).toBe(true);
  });

  it("goes back to 'no team yet' once no verified rescue team covers it", async () => {
    await asOwner(db);
    await db.query(
      `update authority_units set status = 'suspended'
        where id in (select unit_id from authority_coverage where tambon = $1)
          and 'rescue' = any (capabilities)`,
      [w.yala1],
    );
    await as(db, "anon");
    // The verified planning office on the same tambon does not make it covered.
    expect(await covered(w.yala1)).toBe(false);
  });

  it("does not count a team that is still waiting to be verified", async () => {
    await asOwner(db);
    await db.query(
      `update authority_units set status = 'suspended'
        where id in (select unit_id from authority_coverage where tambon = $1)
          and id <> $2`,
      [w.yala1, w.yalaPending.id],
    );
    await as(db, "anon");
    expect(await covered(w.yala1)).toBe(false);
  });
});
