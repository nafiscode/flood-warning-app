/**
 * S11, season state: the monthly reference, the live grade, and the one soft notice.
 *
 * What these tests are really guarding: that **nothing here can publish**. The owner asked for an
 * automatic soft alert; safety rule 2 keeps publishing in human hands, so the road built instead
 * is a row an admin reads. These tests check both halves - that the figures reach an admin and
 * nobody else, and that the tick, the notice and the review never touch `alerts`.
 */
import type { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { as, asOwner, connect, expectDenied, rows } from "./db";
import { buildWorld, type World } from "./fixtures";

let db: Client;
let w: World;
const ZONE = "00000000-0000-4000-8000-0000000000b1";
const STATION = "00000000-0000-4000-8000-0000000000b2";
const THAIWATER = 991100;

/** The Bangkok month the rule is reading right now: the reference has to match it. */
async function month(): Promise<number> {
  const got = await rows<{ m: number }>(
    db,
    "select extract(month from (now() at time zone 'Asia/Bangkok'))::integer m",
  );
  return got[0]!.m;
}

/** Eight whole Bangkok days of readings, the floor rising by `step` each day. */
async function floorDays(step: number, from = 12) {
  await db.query(
    `delete from public.observations where station_id = $1 and variable = 'water_level_msl'`,
    [STATION],
  );
  await db.query(
    `insert into public.observations (station_id, variable, ts, value)
     select $1, 'water_level_msl',
            (((now() at time zone 'Asia/Bangkok')::date - d) + time '06:00') at time zone 'Asia/Bangkok',
            $2::double precision + (8 - d) * $3::double precision
       from generate_series(1, 8) d`,
    [STATION, from, step],
  );
}

/** Fifteen whole days of daily rain, `perDay` millimetres each. */
async function rainDays(perDay: number) {
  await db.query(`delete from public.forecasts where zone_id = $1 and variable = 'rain_1d_mm'`, [
    ZONE,
  ]);
  await db.query(
    `insert into public.forecasts (source, zone_id, issued_at, valid_at, variable, value)
     select 'open_meteo', $1, now(), ((now() at time zone 'Asia/Bangkok')::date - d)::timestamptz,
            'rain_1d_mm', $2::double precision
       from generate_series(1, 31) d`,
    [ZONE, perDay],
  );
}

type Signal = {
  grade: string;
  rose_days: number | null;
  reasons: string[];
  floor_band: string;
  rain_15d_band: string;
  floor_vs_normal_m: number | null;
  stale: boolean;
  figures: { blind: string[] };
};

const signal = async (): Promise<Signal> =>
  (await rows<Signal>(db, "select * from public.season_signal($1)", [ZONE]))[0]!;

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
  await db.query(
    `insert into public.warning_zones (id, name, basin)
     values ($1, '{"en": "Test river"}'::jsonb, 'test_river')`,
    [ZONE],
  );
  await db.query(
    `insert into public.stations (id, thaiwater_id, code, name, source, point)
     values ($1, $2, 'T.1', '{"en": "Test gauge"}'::jsonb, 'test',
             st_setsrid(st_makepoint(101.27, 6.55), 4326))`,
    [STATION, THAIWATER],
  );
  // The zone's key gauge is read from the feed settings, as the dashboard and the alarm read it.
  await db.query(
    `update public.system_settings
        set value = jsonb_set(value, array['zones', 'test_river'],
                              jsonb_build_object('gauges', jsonb_build_object('key', $1::integer)), true)
      where key = 'signal_feed'`,
    [THAIWATER],
  );
  const m = await month();
  await db.query(
    `insert into public.season_baseflow (station_id, month, floor_p33, floor_p50, floor_p67,
                                         rise_p33, rise_p50, rise_p67, seasons, days, sea_m, pulse_m)
     values ($1, $2, 12.5, 13.0, 13.5, -0.2, 0.05, 0.2, 6, 180, 0.02, 0.1)`,
    [STATION, m],
  );
  await db.query(
    `insert into public.season_rain (zone_id, month, d15_p33, d15_p50, d15_p67,
                                      d30_p33, d30_p50, d30_p67, std_p33, std_p50, std_p67,
                                      seasons, days)
     values ($1, $2, 100, 150, 200, 200, 300, 400, 300, 400, 500, 9, 183)`,
    [ZONE, m],
  );
});
afterEach(async () => {
  await db.query("rollback");
});

describe("the figures", () => {
  it("grades a zone rising_wet only when both legs hold", async () => {
    // Rising, and a wet fortnight: 15 mm a day is 225 mm, over the upper third of 200.
    await floorDays(0.05);
    await rainDays(15);
    const both = await signal();
    expect(both.grade).toBe("rising_wet");
    expect(both.rose_days).toBe(7);
    expect(both.reasons).toEqual(["rising_week", "wet_fortnight"]);

    // The same rise with an ordinary fortnight raises nothing.
    await rainDays(10);
    expect((await signal()).grade).toBe("rising");

    // A wet fortnight with a falling river raises nothing either.
    await floorDays(-0.05);
    await rainDays(15);
    expect((await signal()).grade).toBe("wet");

    await floorDays(-0.05);
    await rainDays(5);
    expect((await signal()).grade).toBe("quiet");
  });

  it("a catchment running below normal can still be graded rising_wet", async () => {
    // The November 2025 shape at X.40A: the floor in the bottom third of its own record two days
    // before the river left its bank. "Above normal" is context, never a condition, so this must
    // still fire (owner's decision, 10 November 2026).
    await floorDays(0.05, 10);
    await rainDays(15);
    const s = await signal();
    expect(s.floor_band).toBe("low");
    expect(s.floor_vs_normal_m).toBeLessThan(0);
    expect(s.grade).toBe("rising_wet");
  });

  it("a gap in the readings yields no grade rather than a guess", async () => {
    await floorDays(0.05);
    await rainDays(15);
    // Take one day out of the eight.
    await db.query(
      `delete from public.observations
        where station_id = $1
          and (ts at time zone 'Asia/Bangkok')::date = (now() at time zone 'Asia/Bangkok')::date - 4`,
      [STATION],
    );
    const s = await signal();
    expect(s.rose_days).toBeNull();
    expect(s.grade).toBe("wet");
    expect(s.figures.blind).toContain("gaugeDays");
  });

  it("fewer than fifteen whole days of rain is not a dry fortnight", async () => {
    await floorDays(0.05);
    await rainDays(15);
    await db.query(
      `delete from public.forecasts
        where zone_id = $1 and variable = 'rain_1d_mm'
          and valid_at::date > (now() at time zone 'Asia/Bangkok')::date - 6`,
      [ZONE],
    );
    const s = await signal();
    expect(s.rain_15d_band).toBe("unknown");
    expect(s.grade).toBe("rising");
    expect(s.figures.blind).toContain("rainDays");
  });

  it("a stale gauge cannot satisfy the rising leg", async () => {
    await floorDays(0.05);
    await rainDays(15);
    await db.query(
      `update public.observations set ts = ts - interval '40 days' where station_id = $1`,
      [STATION],
    );
    const s = await signal();
    expect(s.grade).toBe("wet");
    expect(s.figures.blind).toContain("gaugeDays");
  });

  it("a figure with no reference is unknown, never normal", async () => {
    const got = await rows<{ a: string; b: string; c: string; d: string }>(
      db,
      `select public.season_band(5, null, null) a, public.season_band(null, 1, 2) b,
              public.season_band(0.5, 1, 2) c, public.season_band(2.5, 1, 2) d`,
    );
    expect(got[0]).toEqual({ a: "unknown", b: "unknown", c: "low", d: "high" });
  });

  it("no client may read the figures directly, nor run the tick", async () => {
    for (const who of [null, w.requester, w.admin]) {
      await as(db, who ? { uid: who } : "anon");
      await expectDenied(db, `select public.season_signal('${ZONE}')`);
      await expectDenied(db, "select public.season_tick()");
    }
  });
});

describe("the notice", () => {
  beforeEach(async () => {
    await asOwner(db);
    await floorDays(0.05);
    await rainDays(15);
  });

  it("is raised once per episode, and publishes nothing", async () => {
    const before = await rows<{ n: number }>(db, "select count(*)::int n from public.alerts");
    expect(await rows(db, "select public.season_tick() n")).toEqual([{ n: 1 }]);
    expect(await rows(db, "select public.season_tick() n")).toEqual([{ n: 0 }]);
    const open = await rows<{ grade: string; status: string }>(
      db,
      `select grade, status from public.season_notices where zone_id = $1`,
      [ZONE],
    );
    expect(open).toEqual([{ grade: "rising_wet", status: "open" }]);
    const after = await rows<{ n: number }>(db, "select count(*)::int n from public.alerts");
    expect(after[0]!.n).toBe(before[0]!.n);
  });

  it("closes itself when the zone goes quiet, and opens again for the next episode", async () => {
    await db.query("select public.season_tick()");
    await floorDays(-0.05);
    await rainDays(5);
    await db.query("select public.season_tick()");
    expect(
      await rows(db, `select status from public.season_notices where zone_id = $1`, [ZONE]),
    ).toEqual([{ status: "ended" }]);
    // A one-day dip does not close one: only `quiet` does, so one spell of weather is one notice.
    await floorDays(0.05);
    await rainDays(15);
    await db.query("select public.season_tick()");
    await rainDays(10); // `rising` only
    await db.query("select public.season_tick()");
    const now = await rows<{ status: string }>(
      db,
      `select status from public.season_notices where zone_id = $1 order by raised_at`,
      [ZONE],
    );
    expect(now.map((r) => r.status)).toEqual(["ended", "open"]);
  });

  it("is read by an admin and by nobody else, and written by no client", async () => {
    await db.query("select public.season_tick()");
    await as(db, { uid: w.admin });
    expect(await rows(db, "select id from public.season_notices")).toHaveLength(1);
    expect(await rows(db, "select * from public.admin_season_notices(60)")).toHaveLength(1);
    // A visitor has no grant at all, so the read is refused before any policy is consulted; a
    // signed-in resident has the grant and the policy gives them nothing.
    await as(db, "anon");
    await expectDenied(db, "select id from public.season_notices");
    await expectDenied(db, "select * from public.admin_season_notices(60)");
    await as(db, { uid: w.requester });
    expect(await rows(db, "select id from public.season_notices")).toHaveLength(0);
    expect(await rows(db, "select * from public.admin_season_notices(60)")).toHaveLength(0);
    for (const who of [null, w.requester, w.admin]) {
      await as(db, who ? { uid: who } : "anon");
      await expectDenied(
        db,
        `insert into public.season_notices (zone_id, grade) values ('${ZONE}', 'rising_wet')`,
      );
      await expectDenied(db, `delete from public.season_notices`);
    }
  });

  it("an admin's judgement is written down and logged, and publishes nothing", async () => {
    await db.query("select public.season_tick()");
    const notice = (
      await rows<{ id: string }>(db, "select id from public.season_notices limit 1")
    )[0]!.id;
    const before = await rows<{ n: number }>(db, "select count(*)::int n from public.alerts");
    await as(db, { uid: w.admin });
    await rows(db, `select public.admin_season_notice_review($1, 'dismissed', 'not yet')`, [notice]);
    await asOwner(db);
    expect(
      await rows(db, "select status, review_note from public.season_notices where id = $1", [
        notice,
      ]),
    ).toEqual([{ status: "dismissed", review_note: "not yet" }]);
    expect(
      await rows(
        db,
        `select 1 from public.audit_log where action = 'season_notice_review' and entity_id = $1`,
        [notice],
      ),
    ).toHaveLength(1);
    const after = await rows<{ n: number }>(db, "select count(*)::int n from public.alerts");
    expect(after[0]!.n).toBe(before[0]!.n);
  });

  it("only an admin may review, and only to sent or dismissed", async () => {
    await db.query("select public.season_tick()");
    const notice = (
      await rows<{ id: string }>(db, "select id from public.season_notices limit 1")
    )[0]!.id;
    for (const who of [null, w.requester]) {
      await as(db, who ? { uid: who } : "anon");
      await expectDenied(db, `select public.admin_season_notice_review('${notice}', 'dismissed')`);
    }
    await as(db, { uid: w.admin });
    await expectDenied(db, `select public.admin_season_notice_review('${notice}', 'published')`);
  });
});

describe("telling the admins", () => {
  it("owes each admin's phone one push per episode, and only with the server's token", async () => {
    await asOwner(db);
    await floorDays(0.05);
    await rainDays(15);
    await db.query("select public.season_tick()");
    await db.query(
      `insert into public.push_subscriptions (user_id, endpoint, keys, locale, tambons)
       values ($1, 'https://fcm.googleapis.com/admin-phone', '{"p256dh": "k", "auth": "a"}'::jsonb, 'th', '{}')`,
      [w.admin],
    );
    const token = (
      await rows<{ token: string }>(db, "select token from public.push_gate limit 1")
    )[0]!.token;
    const due = await rows<{ endpoint: string; rose_days: number }>(
      db,
      "select * from public.push_season_due($1)",
      [token],
    );
    expect(due).toHaveLength(1);
    expect(due[0]!.endpoint).toBe("https://fcm.googleapis.com/admin-phone");
    expect(due[0]!.rose_days).toBe(7);
    // Owed once: a second tick tells nobody twice.
    expect(await rows(db, "select * from public.push_season_due($1)", [token])).toHaveLength(0);

    for (const who of [null, w.requester, w.admin]) {
      await as(db, who ? { uid: who } : "anon");
      await expectDenied(db, "select public.push_season_due('not-the-token')");
    }
  });

  it("stands in the bell as a silent queue", async () => {
    await asOwner(db);
    await floorDays(0.05);
    await rainDays(15);
    await db.query("select public.season_tick()");
    await as(db, { uid: w.admin });
    const queues = await rows<{ queue: string; waiting: number }>(
      db,
      "select queue, waiting from public.admin_attention()",
    );
    expect(queues.find((q) => q.queue === "seasonNotice")?.waiting).toBe(1);
    // The queues that were there before are still there.
    expect(queues.map((q) => q.queue)).toContain("damNotice");
    expect(queues.map((q) => q.queue)).toContain("staleAlerts");
  });
});

describe("the monthly reference", () => {
  it("is read by an admin and by nobody else", async () => {
    type Answer = { d: { gauges: { code: string }[]; zones: { basin: string }[] } };
    await as(db, { uid: w.admin });
    const got = await rows<Answer>(db, "select public.admin_season_state() d");
    expect(got[0]!.d.gauges.map((g) => g.code)).toContain("T.1");
    expect(got[0]!.d.zones.map((z) => z.basin)).toContain("test_river");
    await as(db, "anon");
    await expectDenied(db, "select public.admin_season_state()");
    await expectDenied(db, "select station_id from public.season_baseflow");
    await as(db, { uid: w.requester });
    const none = await rows<{ d: unknown }>(db, "select public.admin_season_state() d");
    expect(none[0]!.d).toBeNull();
    expect(await rows(db, "select station_id from public.season_baseflow")).toHaveLength(0);
    expect(await rows(db, "select zone_id from public.season_rain")).toHaveLength(0);
  });

  it("is written by no client", async () => {
    for (const who of [null, w.requester, w.admin]) {
      await as(db, who ? { uid: who } : "anon");
      await expectDenied(
        db,
        `insert into public.season_rain (zone_id, month) values ('${ZONE}', 11)`,
      );
      await expectDenied(db, "delete from public.season_baseflow");
    }
  });

  it("the live grade reaches an admin and nobody else", async () => {
    await as(db, { uid: w.admin });
    const got = await rows<{ d: { zones: { basin: string }[] } }>(
      db,
      "select public.admin_season_signals() d",
    );
    expect(got[0]!.d.zones.map((z) => z.basin)).toContain("test_river");
    for (const who of [null, w.requester]) {
      await as(db, who ? { uid: who } : "anon");
      await expectDenied(db, "select public.admin_season_signals()");
    }
  });
});
