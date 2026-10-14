/**
 * The automated alarm (owner's decision, 14 Oct 2026): a ticked gauge over its threshold raises a
 * draft for the admins; if nobody sends or dismisses it within the grace time it is published by
 * itself, marked unreviewed; a river gone back below by then publishes nothing.
 */
import type { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { as, asOwner, connect, expectDenied, rows } from "./db";
import { buildWorld, type World } from "./fixtures";

let db: Client;
let w: World;
let zone: string;
let gauge: string;

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
  // Start from a quiet database: nothing in force, no earlier draft, no other ticked gauge.
  await db.query("delete from public.auto_alarm_events");
  await db.query("update public.auto_alarm_gauges set enabled = false");
  await db.query("update public.alerts set cancelled_at = now() where cancelled_at is null");
  const z = await rows<{ id: string; station: string }>(
    db,
    `select z.id, s.id as station from public.warning_zones z
       join public.stations s on s.zone_id = z.id and s.thaiwater_id = 2583
      where z.basin = 'pattani_river'`,
  );
  zone = z[0]!.id;
  gauge = z[0]!.station;
  await db.query("delete from public.observations where station_id = $1", [gauge]);
  await db.query(
    `update public.system_settings set value = value || '{"mode": "drill", "confirm_readings": 2, "max_age_h": 3}'::jsonb
      where key = 'auto_alarm'`,
  );
});
afterEach(async () => {
  await db.query("rollback");
});

const reading = (hoursAgo: number, value: number) =>
  db.query(
    `insert into public.observations (station_id, ts, variable, value)
     values ($1, now() - make_interval(mins => $2::integer), 'water_level_msl', $3)`,
    [gauge, Math.round(hoursAgo * 60), value],
  );
const check = () => db.query("select public.auto_alarm_check()");
const events = () =>
  rows<{ id: string; level: string; status: string; alert_id: string | null }>(
    db,
    "select id, level, status, alert_id from public.auto_alarm_events where zone_id = $1 order by created_at",
    [zone],
  );

describe("the automated alarm", () => {
  it("does nothing for a gauge nobody ticked", async () => {
    await reading(1, 16.2);
    await reading(0.5, 16.3);
    await check();
    expect(await events()).toHaveLength(0);
  });

  it("raises a Warning draft when two fresh readings reach the Warning level, then publishes it as an unreviewed drill when the time runs out", async () => {
    await as(db, { uid: w.admin });
    await db.query("select public.admin_set_auto_alarm($1, true)", [gauge]);
    await asOwner(db);
    await reading(1, 16.2);
    await reading(0.5, 16.3);
    await check();
    let e = await events();
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ level: "warning", status: "pending" });
    // A second look does not raise another.
    await check();
    expect(await events()).toHaveLength(1);
    await db.query(
      "update public.auto_alarm_events set deadline = now() - interval '1 minute' where zone_id = $1",
      [zone],
    );
    await check();
    e = await events();
    expect(e[0]!.status).toBe("auto_published");
    const alert = await rows<{
      level: string;
      is_drill: boolean;
      snap: { kind: string; reviewed: boolean };
      n: number;
    }>(
      db,
      `select a.level, a.is_drill, a.signals_snapshot as snap,
              (select count(*)::int from public.alert_tambons t where t.alert_id = a.id) n
         from public.alerts a where a.id = $1`,
      [e[0]!.alert_id],
    );
    expect(alert[0]).toMatchObject({
      level: "warning",
      is_drill: true,
      snap: { kind: "auto_alarm", reviewed: false },
    });
    expect(alert[0]!.n).toBeGreaterThan(10);
  });

  it("one reading alone, or an old one, never fires", async () => {
    await as(db, { uid: w.admin });
    await db.query("select public.admin_set_auto_alarm($1, true)", [gauge]);
    await asOwner(db);
    await reading(0.5, 16.4);
    await check();
    expect(await events()).toHaveLength(0);
    await reading(5, 16.4);
    await check();
    expect(await events()).toHaveLength(0);
  });

  it("publishes nothing if the river has gone back below by the end of the grace time", async () => {
    await as(db, { uid: w.admin });
    await db.query("select public.admin_set_auto_alarm($1, true)", [gauge]);
    await asOwner(db);
    await reading(1, 16.2);
    await reading(0.5, 16.3);
    await check();
    await reading(0.1, 15.1);
    await db.query(
      "update public.auto_alarm_events set deadline = now() - interval '1 minute' where zone_id = $1",
      [zone],
    );
    await check();
    const e = await events();
    expect(e[0]).toMatchObject({ status: "lapsed", alert_id: null });
  });

  it("an admin's dismissal stops it, and is logged", async () => {
    await as(db, { uid: w.admin });
    await db.query("select public.admin_set_auto_alarm($1, true)", [gauge]);
    await asOwner(db);
    await reading(1, 16.6);
    await reading(0.5, 16.7);
    await check();
    const [e] = await events();
    expect(e!.level).toBe("evacuate");
    await as(db, { uid: w.admin });
    await db.query(
      "select public.admin_dismiss_auto_alarm($1, 'checked with the irrigation office')",
      [e!.id],
    );
    await asOwner(db);
    await db.query(
      "update public.auto_alarm_events set deadline = now() - interval '1 minute' where zone_id = $1",
      [zone],
    );
    await check();
    expect((await events())[0]!.status).toBe("dismissed");
    const log = await rows(
      db,
      "select 1 from public.audit_log where action = 'auto_alarm_dismissed' and entity_id = $1",
      [e!.id],
    );
    expect(log).toHaveLength(1);
  });

  it("nobody but an admin may switch it, dismiss a draft or change the mode", async () => {
    for (const who of [null, w.requester]) {
      await as(db, who ? { uid: who } : "anon");
      await expectDenied(db, "select public.admin_set_auto_alarm(null, true)");
      await expectDenied(db, "select public.admin_set_auto_alarm_mode('real')");
      await expectDenied(db, "select public.auto_alarm_check()");
      expect(await rows(db, "select 1 from public.auto_alarm_events")).toHaveLength(0);
    }
    await as(db, { uid: w.admin });
    await expectDenied(db, "select public.admin_set_auto_alarm_mode('sometimes')");
    const n = await rows<{ n: number }>(db, "select public.admin_set_auto_alarm(null, true) n");
    expect(n[0]!.n).toBeGreaterThan(5);
  });

  it("the push tick is refused without the server's token", async () => {
    await as(db, "anon");
    await expectDenied(
      db,
      "select * from public.auto_alarm_push_due('not-the-token-not-the-token-xx')",
    );
  });
});
