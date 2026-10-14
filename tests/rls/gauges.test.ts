/**
 * A8: the live river gauges. Readings are public (the agencies publish them); only the database's
 * own job may fetch or write them, and only admins see the feed's log.
 */
import type { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { as, asOwner, connect, expectDenied, rows } from "./db";
import { buildWorld, type World } from "./fixtures";

let db: Client;
let w: World;
let station: string;

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
  const made = await rows<{ id: string }>(
    db,
    `insert into public.stations (source, code, name, point, bankfull_m, watch_m, warning_m, thaiwater_id)
     values ('test', 'T.1', '{"th": "ทดสอบ"}'::jsonb, extensions.st_setsrid(extensions.st_makepoint(101.2, 6.5), 4326),
             10, 9.5, 10, -1)
     returning id`,
  );
  station = made[0]!.id;
  await db.query("insert into public.gauge_feed_log (ok, rows_stored) values (true, 3)");
});
afterEach(async () => {
  await db.query("rollback");
});

const status = async () =>
  (
    await rows<{ status: string }>(db, "select status from public.station_status() where id = $1", [
      station,
    ])
  )[0]?.status;

describe("the gauges", () => {
  it("a visitor reads a gauge's state, which follows its newest reading", async () => {
    await asOwner(db);
    await db.query(
      "insert into public.observations (station_id, ts, variable, value) values ($1, now() - interval '1 hour', 'water_level_msl', 9.7)",
      [station],
    );
    await as(db, "anon");
    expect(await status()).toBe("above_watch");
    await asOwner(db);
    await db.query(
      "insert into public.observations (station_id, ts, variable, value) values ($1, now() - interval '10 minutes', 'water_level_msl', 10.2)",
      [station],
    );
    await as(db, "anon");
    expect(await status()).toBe("above_warning");
  });

  it("a gauge whose newest reading is older than six hours says so, whatever it read", async () => {
    await asOwner(db);
    await db.query(
      "insert into public.observations (station_id, ts, variable, value) values ($1, now() - interval '7 hours', 'water_level_msl', 12)",
      [station],
    );
    await as(db, "anon");
    expect(await status()).toBe("no_recent_data");
  });

  it("no client may run the fetch, and only an admin may correct a reading by hand", async () => {
    const insert =
      "insert into public.observations (station_id, ts, variable, value) values ($1, now(), 'water_level_msl', 1)";
    for (const who of [null, w.requester, w.admin]) {
      await as(db, who ? { uid: who } : "anon");
      await expectDenied(db, "select public.gauges_fetch()");
      // Reference data is the admins' to correct (the access rules of September); nobody else's.
      if (who !== w.admin) await expectDenied(db, insert, [station]);
    }
    await as(db, { uid: w.admin });
    await db.query(insert, [station]);
  });

  it("the feed's log is for admins only", async () => {
    await as(db, "anon");
    expect(await rows(db, "select 1 from public.gauge_feed_log")).toHaveLength(0);
    await as(db, { uid: w.requester });
    expect(await rows(db, "select 1 from public.gauge_feed_log")).toHaveLength(0);
    await as(db, { uid: w.admin });
    expect((await rows(db, "select 1 from public.gauge_feed_log")).length).toBeGreaterThan(0);
    await expectDenied(db, "delete from public.gauge_feed_log");
  });
  it("tells a visitor the rise over about three hours and the bank, and calls a gauge near its bank half a metre below it", async () => {
    await asOwner(db);
    await db.query("update public.stations set watch_m = null where id = $1", [station]);
    for (const [age, value] of [
      ["3 hours 10 minutes", 9.1],
      ["1 hour", 9.4],
      ["5 minutes", 9.6],
    ] as const) {
      await db.query(
        "insert into public.observations (station_id, ts, variable, value) values ($1, now() - $2::interval, 'water_level_msl', $3)",
        [station, age, value],
      );
    }
    await as(db, "anon");
    const row = (
      await rows<{ status: string; rise_3h: number; bank_m: number; code: string }>(
        db,
        "select status, rise_3h, bank_m, code from public.station_status() where id = $1",
        [station],
      )
    )[0]!;
    expect(row.status).toBe("above_watch");
    expect(row.rise_3h).toBeCloseTo(0.5, 5);
    expect(row.bank_m).toBe(10);
    expect(row.code).toBe("T.1");
  });
});
