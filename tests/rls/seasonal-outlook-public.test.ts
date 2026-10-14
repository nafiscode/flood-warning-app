/**
 * S8: the public line of the seasonal outlook. Anyone may read the summary through the function;
 * the table itself stays admins only.
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
  await asOwner(db);
  await db.query("delete from public.seasonal_outlooks");
  await db.query(
    `insert into public.seasonal_outlooks (season, issued_on, method, lean, odds_dry, odds_normal, odds_wet,
       past_hit_pct, chance_hit_pct, past_seasons, usable, note, details) values
     (2030, '2030-10-14', 'summary', 'none', null, null, null, null, null, null, true, 'disagree', '{}'),
     (2030, '2030-10-14', 'pacific', 'dry', 50, 33, 17, 38.5, 31.5, 30, true, 'p', '{"oni": 2.16}'),
     (2030, '2030-10-14', 'ccsm4', 'normal', 27, 46, 27, 51.5, 31.5, 30, true, 'm', '{}'),
     (2030, '2030-10-14', 'cfsv2', 'wet', 34, 47, 19, 18.5, 31.5, 30, false, 'x', '{}'),
     (2029, '2029-10-10', 'summary', 'wet', null, null, null, null, null, null, true, 'old', '{}')`,
  );
});
afterEach(async () => {
  await db.query("rollback");
});

const latest = async () =>
  (
    await rows<{ o: Record<string, unknown> | null }>(
      db,
      "select public.public_seasonal_outlook() o",
    )
  )[0]!.o;

describe("public_seasonal_outlook", () => {
  it("gives a visitor the newest issue's summary, the Pacific's phase and the skill of the methods used", async () => {
    await as(db, "anon");
    expect(await latest()).toEqual({
      season: 2030,
      issued_on: "2030-10-14",
      lean: "none",
      pacific: "el_nino",
      skill_pct: 51.5,
      chance_pct: 31.5,
    });
  });

  it("leaves the table itself closed to visitors and signed-in people", async () => {
    for (const who of ["anon", { uid: w.requester }] as const) {
      await as(db, who);
      const n = (
        await rows<{ n: number }>(db, "select count(*)::int n from public.seasonal_outlooks")
      )[0]!.n;
      expect(n).toBe(0);
      expect(await latest()).not.toBeNull();
    }
  });

  it("answers null when no outlook was ever issued", async () => {
    await asOwner(db);
    await db.query("delete from public.seasonal_outlooks");
    await as(db, "anon");
    expect(await latest()).toBeNull();
  });
});
