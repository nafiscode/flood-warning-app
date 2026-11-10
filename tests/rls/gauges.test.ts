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

  /*
   * A10, 21 Oct 2026: the public map grades on the gauge's own levels in `gauge_levels` - the same
   * ones the admins' signals read - and only falls back to the `stations` columns for a gauge that
   * has no row there (the test above). Before this the two disagreed on 39 of the 46 gauges that
   * have both, and an admin's own levels never reached the public map at all.
   */
  it("grades a visitor's gauge on the gauge's own levels, Evacuate included", async () => {
    await asOwner(db);
    // Its own levels sit well below the `stations` columns (watch 9.5, warning 10).
    await db.query(
      "insert into public.gauge_levels (station_id, watch_m, warning_m, evacuate_m) values ($1, 6, 7, 8)",
      [station],
    );
    const reads = async (value: number) => {
      await asOwner(db);
      await db.query("delete from public.observations where station_id = $1", [station]);
      await db.query(
        "insert into public.observations (station_id, ts, variable, value) values ($1, now() - interval '10 minutes', 'water_level_msl', $2)",
        [station, value],
      );
      await as(db, "anon");
      return status();
    };
    expect(await reads(5.9)).toBe("normal");
    expect(await reads(6.2)).toBe("above_watch");
    expect(await reads(7.4)).toBe("above_warning");
    // At or over its Evacuate level - its bank - the map says so in its own word, never a lower
    // one: a level is never shown lower than it is (safety rule 3).
    expect(await reads(8)).toBe("above_evacuate");
    expect(await reads(9.9)).toBe("above_evacuate");
  });

  it("says nothing of a gauge with no levels in either place", async () => {
    await asOwner(db);
    await db.query("update public.stations set watch_m = null, warning_m = null where id = $1", [
      station,
    ]);
    await db.query(
      "insert into public.observations (station_id, ts, variable, value) values ($1, now(), 'water_level_msl', 4)",
      [station],
    );
    await as(db, "anon");
    expect(await status()).toBe("no_levels");
  });

  /*
   * `station_status()` is `security definer` because it reads `gauge_levels`, which only admins may
   * select. Nothing from that table leaves the function: the levels become one word, and the bank
   * level was public before this.
   */
  it("still does not let a visitor read the levels themselves", async () => {
    await asOwner(db);
    await db.query(
      "insert into public.gauge_levels (station_id, watch_m, warning_m, evacuate_m) values ($1, 6, 7, 8)",
      [station],
    );
    // A visitor may not select from the table at all; a signed-in non-admin is let in and shown
    // nothing by the policy. Neither of them can read a level, which is the point.
    await as(db, "anon");
    await expectDenied(db, "select 1 from public.gauge_levels");
    await as(db, { uid: w.requester });
    expect(await rows(db, "select 1 from public.gauge_levels")).toHaveLength(0);
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

/*
 * The week behind each river (the owner, 10 Nov 2026; science plan Module 11). `station_status()`
 * now also says on how many of the last seven whole Bangkok days this river's daily low rose.
 * What matters here is what it refuses to say: a station the tide moves, or one with a gap, gets
 * no figure at all rather than a figure that reads as a steady week.
 */
describe("the week each river has had", () => {
  /** Readings for `days` whole Bangkok days back from yesterday, each `step` m above the last. */
  const giveDays = async (days: number, step: number, from = 1) => {
    await asOwner(db);
    for (let d = days; d >= 1; d -= 1) {
      const level = 5 + (days - d) * step;
      for (const hour of [2, 11, 20]) {
        await db.query(
          `insert into public.observations (station_id, ts, variable, value)
           values ($1, (((now() at time zone 'Asia/Bangkok')::date - $2::integer)::timestamp
                        + make_interval(hours => $3::integer)) at time zone 'Asia/Bangkok',
                   'water_level_msl', $4)
           on conflict do nothing`,
          [station, d + from - 1, hour, level + hour / 1000],
        );
      }
    }
  };
  /** Module 11 keeps this station: a reference row is what says the catchment moves it. */
  const keepStation = async () => {
    await asOwner(db);
    await db.query(
      `insert into public.season_baseflow (station_id, month, seasons, days, method)
       values ($1, 11, 6, 500, '{"test": true}'::jsonb)
       on conflict (station_id, month) do nothing`,
      [station],
    );
  };
  const week = async () =>
    (
      await rows<{ rose_days: number | null; week_change_m: number | null }>(
        db,
        "select rose_days, week_change_m from public.station_status() where id = $1",
        [station],
      )
    )[0]!;

  it("counts the days a kept river's daily low rose, and a visitor may read them", async () => {
    await giveDays(9, 0.1);
    await keepStation();
    await as(db, "anon");
    const w = await week();
    // Eight whole days, every one above the last: seven comparisons, all rising.
    expect(w.rose_days).toBe(7);
    expect(w.week_change_m).toBeCloseTo(0.7, 2);
  });

  it("says nothing at all about a station Module 11 does not keep", async () => {
    // The same readings, but no reference row: this is a gauge the tide or a dam moves, whose
    // daily low is not a measure of the catchment. No figure, rather than a wrong one.
    await giveDays(9, 0.1);
    await as(db, "anon");
    const w = await week();
    expect(w.rose_days).toBeNull();
    expect(w.week_change_m).toBeNull();
  });

  it("says nothing when the eight days have a gap", async () => {
    await keepStation();
    // Seven of the eight days, so the run is incomplete: a missing day must never be able to
    // look like a day the river did not rise.
    await giveDays(7, 0.1);
    await as(db, "anon");
    expect((await week()).rose_days).toBeNull();
  });

  it("says nothing when the river has been silent for a day and a half", async () => {
    await keepStation();
    // The eight days are there, but they end two days ago.
    await giveDays(9, 0.1, 3);
    await as(db, "anon");
    expect((await week()).rose_days).toBeNull();
  });

  it("still lets nobody read the reference table it asks", async () => {
    await keepStation();
    await as(db, "anon");
    await expectDenied(db, "select count(*) from public.season_baseflow");
    await as(db, { uid: w.requester });
    // A signed-in resident has the grant and is shown nothing by the policy.
    expect(await rows(db, "select * from public.season_baseflow")).toHaveLength(0);
  });
});
