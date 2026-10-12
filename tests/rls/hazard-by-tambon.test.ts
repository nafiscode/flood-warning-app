/**
 * S3: the hazard classes summed per tambon. Public to read, written by nobody but the seed.
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
  await asOwner(db);
  // The test brings its own row, so it does not depend on the seed having been loaded.
  await db.query("delete from public.hazard_by_tambon where tambon_code = $1", [w.yala1]);
  await db.query(
    `insert into public.hazard_by_tambon (tambon_code, radar_run, land_km2, buildings,
       high_km2, high_pct, high_buildings, medium_km2, medium_pct, medium_buildings,
       low_km2, low_pct, low_buildings, minimal_km2, minimal_pct, minimal_buildings,
       buildings_medium_or_high_pct, medium_or_high_by_elevation_only_pct)
     values ($1, 'test', 10, 100, 1, 10, 5, 2, 20, 35, 3, 30, 40, 4, 40, 20, 40, 60)`,
    [w.yala1],
  );
});
afterEach(async () => {
  await db.query("rollback");
});

const mine = async () =>
  (
    await rows<{ pct: number }>(
      db,
      "select buildings_medium_or_high_pct pct from public.hazard_by_tambon where tambon_code = $1",
      [w.yala1],
    )
  )[0];

describe("hazard_by_tambon", () => {
  it("is read by a visitor and by a signed-in person", async () => {
    await as(db, "anon");
    expect((await mine())?.pct).toBe(40);
    await as(db, { uid: w.requester });
    expect((await mine())?.pct).toBe(40);
  });

  it("is written by no client, whatever their role", async () => {
    for (const who of [null, w.requester, w.admin]) {
      await as(db, who ? { uid: who } : "anon");
      await expectDenied(db, "update public.hazard_by_tambon set high_pct = 0");
      await expectDenied(db, "delete from public.hazard_by_tambon");
      await expectDenied(
        db,
        `insert into public.hazard_by_tambon (tambon_code, radar_run, land_km2, buildings,
           high_km2, high_buildings, medium_km2, medium_buildings, low_km2, low_buildings,
           minimal_km2, minimal_buildings)
         values ($1, 'x', 1, 1, 0, 0, 0, 0, 0, 0, 1, 1)`,
        [w.yala2],
      );
    }
    await asOwner(db);
    expect((await mine())?.pct).toBe(40);
  });

  it("refuses a share outside 0 to 100, even from the seed", async () => {
    await asOwner(db);
    await expectDenied(
      db,
      "update public.hazard_by_tambon set buildings_medium_or_high_pct = 140 where tambon_code = $1",
      [w.yala1],
    );
  });
});
