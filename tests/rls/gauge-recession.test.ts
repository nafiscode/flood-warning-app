/**
 * How long each river gauge took to fall back after its past floods (science plan Module 5, 15 Oct
 * 2026): written by the pipeline's seed, read by admins only, written by no client.
 */
import type { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { as, asOwner, connect, expectDenied, rows } from "./db";
import { buildWorld, type World } from "./fixtures";

let db: Client;
let w: World;
let key: string;

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
  const [found] = await rows<{ id: string }>(
    db,
    "select id from public.stations where thaiwater_id = 2583",
  );
  key = found!.id;
  await db.query(
    `insert into public.gauge_recession (station_id, events, to_bank_h_p25, to_bank_h_p50, to_bank_h_p75, method)
     values ($1, 11, 22.8, 34, 60.5, '{"usable": true}')
     on conflict (station_id) do update set to_bank_h_p50 = 34`,
    [key],
  );
});
afterEach(async () => {
  await db.query("rollback");
});

describe("gauge recession", () => {
  it("only admins read it, through the table or the function", async () => {
    await as(db, "anon");
    await expectDenied(db, "select 1 from public.gauge_recession");
    await expectDenied(db, "select 1 from public.admin_gauge_recession()");
    await as(db, { uid: w.requester });
    expect(await rows(db, "select 1 from public.gauge_recession")).toHaveLength(0);
    expect(await rows(db, "select 1 from public.admin_gauge_recession()")).toHaveLength(0);
    await as(db, { uid: w.admin });
    const [row] = await rows<{ to_bank_h_p50: number }>(
      db,
      "select to_bank_h_p50 from public.admin_gauge_recession() where station_id = $1",
      [key],
    );
    expect(row?.to_bank_h_p50).toBe(34);
  });

  it("no client writes it, not even an admin", async () => {
    for (const who of [w.requester, w.admin]) {
      await as(db, { uid: who });
      await expectDenied(
        db,
        "update public.gauge_recession set to_bank_h_p50 = 1 where station_id = $1",
        [key],
      );
      await expectDenied(db, "delete from public.gauge_recession where station_id = $1", [key]);
    }
  });
});
