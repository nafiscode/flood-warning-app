/**
 * Watch, Warning and Evacuate per river gauge (the owner, 14 Oct 2026): suggested by the
 * pipeline, read and changed by admins only, and a zone's key gauge keeps one truth with the
 * zone's own threshold.
 */
import type { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { as, asOwner, connect, expectDenied, rows } from "./db";
import { buildWorld, type World } from "./fixtures";

let db: Client;
let w: World;
let key: string;
let other: string;
let zone: string;

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
  const found = await rows<{ key: string; other: string; zone: string }>(
    db,
    `select k.id as key, o.id as other, k.zone_id as zone from public.stations k
       join public.stations o on o.thaiwater_id = 1095877
      where k.thaiwater_id = 2583`,
  );
  ({ key, other, zone } = found[0]!);
});
afterEach(async () => {
  await db.query("rollback");
});

const set = (
  station: string,
  watch: number | null,
  warning: number | null,
  evacuate: number | null,
) =>
  db.query("select public.admin_set_gauge_levels($1, $2, $3, $4, 'test')", [
    station,
    watch,
    warning,
    evacuate,
  ]);

describe("gauge levels", () => {
  it("only admins read them, through the table or the function", async () => {
    for (const who of [null, w.requester]) {
      await as(db, who ? { uid: who } : "anon");
      if (who) {
        expect(await rows(db, "select 1 from public.gauge_levels")).toHaveLength(0);
        expect(await rows(db, "select 1 from public.admin_gauge_levels()")).toHaveLength(0);
      } else {
        await expectDenied(db, "select 1 from public.gauge_levels");
        await expectDenied(db, "select 1 from public.admin_gauge_levels()");
      }
    }
    await as(db, { uid: w.admin });
    expect((await rows(db, "select 1 from public.admin_gauge_levels()")).length).toBeGreaterThan(
      30,
    );
  });

  it("only an admin sets them, in rising order, and each change is logged", async () => {
    await as(db, { uid: w.requester });
    await expectDenied(db, "select public.admin_set_gauge_levels($1, 1, 2, 3)", [other]);
    await as(db, { uid: w.admin });
    await expectDenied(db, "select public.admin_set_gauge_levels($1, 3, 2, 4)", [other]);
    await expectDenied(db, "select public.admin_set_gauge_levels($1, null, null, null)", [other]);
    await set(other, 37.5, 38.2, 39.7);
    const [row] = await rows<{ watch_m: number; provisional: boolean }>(
      db,
      "select watch_m, provisional from public.admin_gauge_levels() where station_id = $1",
      [other],
    );
    expect(row).toMatchObject({ watch_m: 37.5, provisional: false });
    await asOwner(db);
    const log = await rows(
      db,
      "select 1 from public.audit_log where action = 'gauge_levels_set' and entity_id = $1",
      [other],
    );
    expect(log).toHaveLength(1);
    // A gauge near the sea may sit below mean sea level.
    await as(db, { uid: w.admin });
    await set(other, -0.4, 0.2, 0.5);
  });

  it("a zone's key gauge also moves the zone's key-level threshold", async () => {
    await as(db, { uid: w.admin });
    await set(key, 15.7, 16.1, 16.6);
    await asOwner(db);
    const [t] = await rows<{ levels: { warning: number; evacuate: number } }>(
      db,
      "select levels from public.thresholds where zone_id = $1 and signal = 'key_level_m'",
      [zone],
    );
    expect(t!.levels).toEqual({ watch: 15.7, warning: 16.1, evacuate: 16.6 });
  });

  it("the upstream gauge's levels are the zone's upstream threshold, and an admin's own is kept", async () => {
    await asOwner(db);
    const read = async () =>
      (
        await rows<{ levels: Record<string, number>; provisional: boolean }>(
          db,
          "select levels, provisional from public.thresholds where zone_id = $1 and signal = 'upstream_level_m'",
          [zone],
        )
      )[0];
    // Loaded with the suggestions.
    expect((await read())!.levels).toHaveProperty("evacuate");
    await as(db, { uid: w.admin });
    await set(other, 37.2, 38.0, 39.6);
    await asOwner(db);
    expect(await read()).toEqual({
      levels: { watch: 37.2, warning: 38, evacuate: 39.6 },
      provisional: false,
    });
    // A later sync of the suggestions leaves the admin's figure alone.
    await db.query(
      "update public.gauge_levels set warning_m = 38.5, provisional = true where station_id = $1",
      [other],
    );
    await db.query("select public.gauge_levels_to_zone($1, null)", [other]);
    expect((await read())!.levels.warning).toBe(38);
  });

  it("the automated alarm raises Warning at another gauge's own Evacuate level", async () => {
    await as(db, { uid: w.admin });
    await set(other, 37, 38, 39);
    await asOwner(db);
    await db.query("delete from public.observations where station_id = $1", [other]);
    for (const mins of [40, 10]) {
      await db.query(
        `insert into public.observations (station_id, ts, variable, value)
         values ($1, now() - make_interval(mins => $2::integer), 'water_level_msl', 39.2)`,
        [other, mins],
      );
    }
    const [r] = await rows<{ level: string; threshold: number }>(
      db,
      "select level, threshold from public.auto_alarm_reading($1)",
      [other],
    );
    // 39.2 is below X.77's bank (39.7) but over the Evacuate level set for it.
    expect(r).toMatchObject({ level: "warning", threshold: 39 });
  });
});
