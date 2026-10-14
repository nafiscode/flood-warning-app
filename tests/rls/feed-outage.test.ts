/**
 * A8's acceptance: when a source goes down, nothing breaks. The fetches record the failure and
 * return, what was stored before is kept, the gauges say their readings are old, and the admins'
 * dashboard still answers with the failure and its time.
 *
 * The outage is simulated by pointing every feed at a port where nothing listens, inside a
 * transaction that is rolled back.
 */
import type { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { as, asOwner, connect, rows } from "./db";
import { buildWorld, type World } from "./fixtures";

const DEAD = "http://127.0.0.1:9/down";

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
});
afterEach(async () => {
  await db.query("rollback");
});

describe("a source that is down", () => {
  it("the gauge fetch logs the failure, keeps the readings it had, and the gauge says they are old", async () => {
    await asOwner(db);
    await db.query(
      `insert into public.system_settings (key, value) values ('gauge_feed', $1::jsonb)
       on conflict (key) do update set value = excluded.value`,
      [JSON.stringify({ url: DEAD, provinces: ["94", "96"], timeout_s: 5 })],
    );
    const made = await rows<{ id: string }>(
      db,
      `insert into public.stations (source, code, name, point, bankfull_m, warning_m, thaiwater_id)
       values ('test', 'T.OUT', '{"th": "ทดสอบ"}'::jsonb,
               extensions.st_setsrid(extensions.st_makepoint(101.2, 6.5), 4326), 10, 10, -2)
       returning id`,
    );
    const station = made[0]!.id;
    await db.query(
      "insert into public.observations (station_id, ts, variable, value) values ($1, now() - interval '7 hours', 'water_level_msl', 8.2)",
      [station],
    );

    const n = await rows<{ n: number }>(db, "select public.gauges_fetch() n");
    expect(n[0]!.n).toBe(0);
    const log = (
      await rows<{ ok: boolean; rows_stored: number; error: string }>(
        db,
        "select ok, rows_stored, error from public.gauge_feed_log order by id desc limit 1",
      )
    )[0]!;
    expect(log.ok).toBe(false);
    expect(log.rows_stored).toBe(0);
    // Each province's failure is named, so an admin can tell one province from all of them.
    expect(log.error).toContain("94:");
    expect(log.error).toContain("96:");

    const kept = await rows(
      db,
      "select 1 from public.observations where station_id = $1 and variable = 'water_level_msl'",
      [station],
    );
    expect(kept).toHaveLength(1);
    await as(db, "anon");
    const status = await rows<{ status: string }>(
      db,
      "select status from public.station_status() where id = $1",
      [station],
    );
    expect(status[0]!.status).toBe("no_recent_data");
  });

  it("the forecast fetch logs the failure, keeps the forecasts it had, and the dashboard still answers", async () => {
    await asOwner(db);
    const zone = (
      await rows<{ id: string }>(
        db,
        "select id from public.warning_zones order by name ->> 'en' limit 1",
      )
    )[0];
    // CI's database has the seeded zones; without one there is nothing to fetch for.
    if (!zone) return;
    const feed = (
      await rows<{ value: Record<string, unknown> }>(
        db,
        "select value from public.system_settings where key = 'signal_feed'",
      )
    )[0]?.value;
    if (!feed) return;
    await db.query(
      "update public.system_settings set value = $1::jsonb where key = 'signal_feed'",
      [
        JSON.stringify({
          ...feed,
          rain_url: DEAD,
          flood_url: DEAD,
          marine_url: DEAD,
          timeout_s: 5,
        }),
      ],
    );
    await db.query("delete from public.forecasts where zone_id = $1", [zone.id]);
    await db.query(
      `insert into public.forecasts (source, zone_id, variable, issued_at, valid_at, value)
       values ('open_meteo', $1, 'rain_1h_mm', now() - interval '2 hours', now() + interval '1 hour', 4.5)`,
      [zone.id],
    );

    const n = await rows<{ n: number }>(db, "select public.signals_fetch() n");
    expect(n[0]!.n).toBe(0);
    const log = (
      await rows<{ ok: boolean; error: string }>(
        db,
        "select ok, error from public.signal_feed_log order by id desc limit 1",
      )
    )[0]!;
    expect(log.ok).toBe(false);
    expect(log.error.length).toBeGreaterThan(0);

    const kept = await rows(
      db,
      "select 1 from public.forecasts where zone_id = $1 and variable = 'rain_1h_mm'",
      [zone.id],
    );
    expect(kept).toHaveLength(1);

    await as(db, { uid: w.admin });
    const answer = (
      await rows<{ s: { feeds: { signals: { ok: boolean; at: string } } } }>(
        db,
        "select public.admin_signals() s",
      )
    )[0]!.s;
    expect(answer.feeds.signals.ok).toBe(false);
    expect(answer.feeds.signals.at).toBeTruthy();
  });
});
