/**
 * ThaiWater's own grading of a gauge: who may read it, and what it must never become.
 *
 * The owner asked on 24 Nov 2026 why the alarm was silent while rivers were up. It was right -
 * nothing stood above Jaga's own Warning - but ThaiWater's map was grading 15 of our stations at
 * `situation_level` 4 and Jaga could not see that at all. These figures were already arriving in
 * the feed and being dropped; now they are kept.
 *
 * What these tests are really guarding is that keeping them changed nothing about who warns. The
 * agency's grade is a cross-check an admin reads, not a second opinion the app acts on: it reaches
 * an admin and nobody else (safety rule 5), it stays null rather than calm where the agency says
 * nothing (safety rule 10), and no path from it touches `alerts` or the alarm (safety rule 2).
 */
import type { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { as, asOwner, connect, expectDenied, rows } from "./db";
import { buildWorld, type World } from "./fixtures";

let db: Client;
let w: World;
const STATION = "00000000-0000-4000-8000-0000000000c1";
const THAIWATER = 991201;

/** One station of our own, so the test never depends on jaga-dev's own rows. */
async function station(code = "T.TEST") {
  await db.query(
    `insert into public.stations (id, code, name, thaiwater_id, warning_m, point)
     values ($1, $2, '{"th":"สถานีทดสอบ"}'::jsonb, $3, 10.0,
             extensions.st_setsrid(extensions.st_makepoint(101.2, 6.5), 4326))
     on conflict (id) do nothing`,
    [STATION, code, THAIWATER],
  );
  await db.query(
    `insert into public.gauge_levels (station_id, watch_m, warning_m, evacuate_m, provisional)
     values ($1, 8.0, 9.0, 10.0, true) on conflict (station_id) do nothing`,
    [STATION],
  );
}

/** A reading, `hoursAgo` back. */
async function reading(value: number, hoursAgo = 0) {
  await db.query(
    `insert into public.observations (station_id, ts, variable, value)
     values ($1, now() - make_interval(mins => $2::integer), 'water_level_msl', $3::double precision)
     on conflict (station_id, variable, ts) do update set value = excluded.value`,
    [STATION, Math.round(hoursAgo * 60), value],
  );
}

/** The agency's grade for our station. */
async function grade(level: number | null, pct: number | null = null) {
  await db.query(
    `insert into public.gauge_agency_grade
       (station_id, situation_level, channel_full_pct, bank_distance_m, bank_distance_text,
        agency_bank_m, observed_at, fetched_at)
     values ($1, $2, $3, 0.5, 'ต่ำกว่าตลิ่ง (ม.)', 10.0, now(), now())
     on conflict (station_id) do update
       set situation_level = excluded.situation_level,
           channel_full_pct = excluded.channel_full_pct, fetched_at = now()`,
    [STATION, level, pct],
  );
}

beforeAll(async () => {
  db = await connect();
});
afterAll(async () => {
  await db.end();
});
beforeEach(async () => {
  await db.query("begin");
  w = await buildWorld(db);
  await station();
});
afterEach(async () => {
  await db.query("rollback");
});

describe("the agency's own grading of a gauge", () => {
  it("reaches an admin, and nobody else", async () => {
    await grade(4, 92.2);
    await reading(7.0);

    await as(db, { uid: w.admin });
    const mine = await rows(db, "select * from public.admin_gauge_agency_grade()");
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.some((r) => r.code === "T.TEST")).toBe(true);

    // A visitor and a signed-in resident get nothing at all - not a filtered row, no row.
    for (const caller of ["anon" as const, { uid: w.requester }]) {
      await as(db, caller);
      const got = await rows(db, "select * from public.admin_gauge_agency_grade()");
      expect(got).toHaveLength(0);
    }
  });

  it("keeps the table itself closed to a visitor and a resident", async () => {
    await grade(4);
    for (const caller of ["anon" as const, { uid: w.requester }]) {
      await as(db, caller);
      const got = await rows(db, "select * from public.gauge_agency_grade");
      expect(got).toHaveLength(0);
    }
    await as(db, { uid: w.admin });
    expect((await rows(db, "select * from public.gauge_agency_grade")).length).toBeGreaterThan(0);
  });

  it("lets nobody write to it, admin included: only the feed fills it", async () => {
    for (const caller of ["anon" as const, { uid: w.requester }, { uid: w.admin }]) {
      await as(db, caller);
      await expectDenied(db, "insert into public.gauge_agency_grade (station_id) values ($1)", [
        "00000000-0000-4000-8000-0000000000c9",
      ]);
      await expectDenied(db, "update public.gauge_agency_grade set situation_level = 1");
      await expectDenied(db, "delete from public.gauge_agency_grade");
    }
  });

  it("no client may run the feed, so no client can put a grade in", async () => {
    for (const caller of ["anon" as const, { uid: w.requester }, { uid: w.admin }]) {
      await as(db, caller);
      await expectDenied(db, "select public.gauges_fetch()");
    }
  });

  it("says nothing rather than 'calm' where the agency publishes no grade", async () => {
    // 17 of our stations are RID gauges and carry no grade at all. A missing grade must never be
    // dressed up as an all-clear (safety rule 10).
    await grade(null);
    await reading(7.0);
    await as(db, { uid: w.admin });
    const [row] = await rows<{ situation_level: number | null; disagrees: boolean | null }>(
      db,
      "select * from public.admin_gauge_agency_grade() where code = 'T.TEST'",
    );
    expect(row!.situation_level).toBeNull();
    expect(row!.disagrees).toBeNull();
  });

  it("shows the disagreement that sent the owner to two maps", async () => {
    // The agency at 4 while the river is below Jaga's Watch: exactly PAT001 and nine others on
    // 24 Nov 2026. The column states the fact; it does not say which side is right.
    await grade(4, 92.2);
    await reading(7.0); // below Watch 8.0
    await as(db, { uid: w.admin });
    const [high] = await rows<{ disagrees: boolean; jaga_grade: string }>(
      db,
      "select * from public.admin_gauge_agency_grade() where code = 'T.TEST'",
    );
    expect(high!.jaga_grade).toBe("normal");
    expect(high!.disagrees).toBe(true);

    // And the other way about: the agency calm while Jaga is above a line.
    await asOwner(db);
    await grade(1, 10);
    await reading(9.5, 0.1);
    await as(db, { uid: w.admin });
    const [low] = await rows<{ disagrees: boolean; jaga_grade: string }>(
      db,
      "select * from public.admin_gauge_agency_grade() where code = 'T.TEST'",
    );
    expect(low!.jaga_grade).toBe("above_warning");
    expect(low!.disagrees).toBe(true);
  });

  it("agrees without fuss when both sides say the same", async () => {
    await grade(4, 92.2);
    await reading(9.5); // above Jaga's Warning too
    await as(db, { uid: w.admin });
    const [row] = await rows<{ disagrees: boolean }>(
      db,
      "select * from public.admin_gauge_agency_grade() where code = 'T.TEST'",
    );
    expect(row!.disagrees).toBe(false);
  });

  it("carries Jaga's own grade on every row, from Jaga's own levels", async () => {
    await grade(3);
    await reading(8.5); // between Watch 8.0 and Warning 9.0
    await as(db, { uid: w.admin });
    const [row] = await rows<{ jaga_grade: string; jaga_bank_m: number }>(
      db,
      "select * from public.admin_gauge_agency_grade() where code = 'T.TEST'",
    );
    expect(row!.jaga_grade).toBe("above_watch");
    expect(Number(row!.jaga_bank_m)).toBeCloseTo(10.0, 5);
  });

  it("cannot raise, publish or suggest anything", async () => {
    // The whole point of safety rule 2 here: the agency's grade is read, never acted on.
    const before = await rows<{ n: string }>(db, "select count(*) n from public.alerts");
    await grade(5, 120);
    await reading(9.9);
    await as(db, { uid: w.admin });
    await rows(db, "select * from public.admin_gauge_agency_grade()");
    await asOwner(db);
    const after = await rows<{ n: string }>(db, "select count(*) n from public.alerts");
    expect(after[0]!.n).toBe(before[0]!.n);

    // And nothing the alarm reads mentions the table, so it cannot leak in later by accident.
    for (const fn of ["public.auto_alarm_check()", "public.auto_alarm_reading(uuid)"]) {
      const [got] = await rows<{ hit: number }>(
        db,
        `select position('gauge_agency_grade' in pg_get_functiondef($1::regprocedure)) hit`,
        [fn],
      );
      expect(Number(got!.hit)).toBe(0);
    }
  });

  it("remembers the last change of grade, and not every repeat of it", async () => {
    await grade(3);
    await asOwner(db);
    const [first] = await rows<{ changed_at: string | null }>(
      db,
      "select changed_at from public.gauge_agency_grade where station_id = $1",
      [STATION],
    );
    expect(first!.changed_at).not.toBeNull();

    // The feed's own upsert, with the same grade: the transition must stay where it was.
    await db.query(
      `update public.gauge_agency_grade set changed_at = now() - interval '5 days' where station_id = $1`,
      [STATION],
    );
    const [pinned] = await rows<{ changed_at: string }>(
      db,
      "select changed_at from public.gauge_agency_grade where station_id = $1",
      [STATION],
    );
    await grade(3);
    const [same] = await rows<{ changed_at: string; previous_level: number | null }>(
      db,
      "select changed_at, previous_level from public.gauge_agency_grade where station_id = $1",
      [STATION],
    );
    expect(new Date(same!.changed_at).getTime()).toBe(new Date(pinned!.changed_at).getTime());

    // A real change records when, and what it was before.
    await db.query(
      `insert into public.gauge_agency_grade as g (station_id, situation_level, fetched_at)
       values ($1, 5, now())
       on conflict (station_id) do update
         set situation_level = excluded.situation_level, fetched_at = now(),
             changed_at = case when excluded.situation_level is distinct from g.situation_level
                               then now() else g.changed_at end,
             previous_level = case when excluded.situation_level is distinct from g.situation_level
                                   then g.situation_level else g.previous_level end`,
      [STATION],
    );
    const [moved] = await rows<{ situation_level: number; previous_level: number; changed_at: string }>(
      db,
      "select situation_level, previous_level, changed_at from public.gauge_agency_grade where station_id = $1",
      [STATION],
    );
    expect(moved!.situation_level).toBe(5);
    expect(moved!.previous_level).toBe(3);
    expect(new Date(moved!.changed_at).getTime()).toBeGreaterThan(
      new Date(pinned!.changed_at).getTime(),
    );
  });
});
