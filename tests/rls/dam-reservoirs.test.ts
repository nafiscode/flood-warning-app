/**
 * Six reservoirs, not one (the owner, 14 Oct 2026): the RID's five beside EGAT's Bang Lang.
 *
 * They differ in the two ways this file is about, and both can hurt somebody if they are wrong:
 *
 *   1. **A daily reading is twenty-four hours of water.** Every flow and every mean divides by
 *      the reading's own window, so a day's release is not read as an hour's - which would make
 *      it look twenty-four times smaller than it is.
 *   2. **Each dam is graded by its own rules.** Bang Lang's 160 m3/s of turbines would never let
 *      a 6 Mm3 reservoir count as releasing, and its 500 m3/s of inflow would never let one count
 *      as filling. A dam's own `grades` are merged over the shared defaults.
 */
import type { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { as, asOwner, connect, expectDenied, rows } from "./db";

let db: Client;

beforeAll(async () => {
  db = await connect();
});
afterAll(async () => {
  await db?.end();
});
beforeEach(async () => {
  await db.query("begin");
});
afterEach(async () => {
  await db.query("rollback");
});

const one = async <T>(sql: string, params: unknown[] = []) => (await rows<T>(db, sql, params))[0]!;

type Signal = {
  grade: "quiet" | "watchful" | "releasing";
  reasons: string[];
  outflow_cms: number | null;
  inflow_cms: number | null;
  percent_full: number | null;
  stale: boolean;
};

/** A reservoir of our own, so the test never depends on what the feed happens to hold today. */
async function reservoir(over: Record<string, unknown> = {}) {
  await asOwner(db);
  const grades = JSON.stringify({
    turbine_max_cms: 10,
    release_reason: "release_high",
    inflow_high_cms: 20,
    rise_mcm_per_h: 0.05,
    rise_window_h: 1,
    min_consecutive_h: 1,
    stale_after_h: 48,
    ...(over.grades as object),
  });
  await db.query(
    `insert into public.dams (code, name, river, operator, province_code, feed, grades,
                              point, storage_max_mcm, storage_normal_mcm, geometry_source)
     values ('test_res', '{"th": "ทดสอบ", "en": "Test Reservoir"}'::jsonb,
             '{"th": "ลำน้ำทดสอบ", "en": "Test stream"}'::jsonb, 'RID', '90', $1, $2::jsonb,
             extensions.st_setsrid(extensions.st_makepoint(100.5, 6.6), 4326), 10, 10, 'test')`,
    [over.feed ?? "daily", grades],
  );
}

/** One reading, so many hours ago, covering a whole day unless told otherwise. */
async function reading(hoursAgo: number, values: Record<string, number | null>, windowH = 24) {
  await db.query(
    `insert into public.dam_readings (dam_code, observed_at, window_h, storage_mcm, level_m,
                                      inflow_mcm_h, released_mcm_h, spilled_mcm_h)
     values ('test_res', now() - make_interval(hours => $1), $2, $3, $4, $5, $6, $7)`,
    [
      hoursAgo,
      windowH,
      values.storage ?? null,
      values.level ?? null,
      values.inflow ?? null,
      values.released ?? null,
      values.spilled ?? null,
    ],
  );
}

describe("a day's water is not an hour's", () => {
  it("turns a daily volume into the day's mean flow", async () => {
    await reservoir();
    // 0.864 Mm3 released over a day is exactly 10 m3/s.
    await reading(0, { storage: 5, released: 0.864 });
    await as(db, "anon");
    const s = await one<Signal>(`select * from public.dam_signal('test_res')`);
    expect(Number(s.outflow_cms)).toBeCloseTo(10, 3);
    // The same figure read as one hour would be 240 m3/s, which is the mistake this prevents.
    expect(Number(s.outflow_cms)).toBeLessThan(11);
  });

  it("counts a daily reading as twenty-four hours in the day's figures and the fortnight", async () => {
    await reservoir();
    await reading(0, { storage: 5, released: 2.16, inflow: 1.0 });
    await as(db, "anon");
    const daily = await one<{ outflow_hours: number; outflow_mean_cms: number }>(
      `select * from public.dam_daily('test_res', 24)`,
    );
    expect(Number(daily.outflow_hours)).toBe(24);
    expect(Number(daily.outflow_mean_cms)).toBeCloseTo(25, 1);
    const day = await one<{ hours: number; outflow_mean_cms: number }>(
      `select * from public.dam_days('test_res', 2) where hours > 0`,
    );
    expect(Number(day.hours)).toBe(24);
    expect(Number(day.outflow_mean_cms)).toBeCloseTo(25, 1);
  });

  it("still reads an hourly dam the way it always did", async () => {
    await as(db, "anon");
    const s = await one<Signal>(`select * from public.dam_signal('bang_lang')`);
    // Bang Lang's own figures, whatever they are today: a percentage, and no exception thrown.
    expect(s.percent_full === null || Number(s.percent_full) >= 0).toBe(true);
  });
});

describe("each reservoir by its own rules", () => {
  it("calls a release of a tenth of a small reservoir in a day a release", async () => {
    await reservoir();
    // 1 Mm3 a day from a 10 Mm3 reservoir: 11.6 m3/s, over its own 10 m3/s rule.
    await reading(0, { storage: 5, released: 1.0 });
    await as(db, "anon");
    const s = await one<Signal>(`select * from public.dam_signal('test_res')`);
    expect(s.grade).toBe("releasing");
    // And it says why in the words a reservoir with no power station can use.
    expect(s.reasons).toContain("release_high");
    expect(s.reasons).not.toContain("above_turbines");
  });

  it("would call the same figure nothing at all under Bang Lang's rules", async () => {
    await reservoir({ grades: { turbine_max_cms: 160, release_reason: "above_turbines" } });
    await reading(0, { storage: 5, released: 1.0 });
    await as(db, "anon");
    const s = await one<Signal>(`select * from public.dam_signal('test_res')`);
    expect(s.grade).toBe("quiet");
  });

  it("grades a daily dam on one reading, because two would be two days", async () => {
    await reservoir();
    await reading(24, { storage: 5, released: 0 });
    await reading(0, { storage: 5, released: 1.0 });
    await as(db, "anon");
    const s = await one<Signal>(`select * from public.dam_signal('test_res')`);
    // Yesterday was quiet; the rule still counts, because a daily figure is already a day's mean.
    expect(s.grade).toBe("releasing");
  });

  it("calls a reservoir over its normal capacity watchful", async () => {
    await reservoir();
    await reading(0, { storage: 10.5, released: 0 });
    await as(db, "anon");
    const s = await one<Signal>(`select * from public.dam_signal('test_res')`);
    expect(s.grade).toBe("watchful");
    expect(s.reasons).toContain("above_normal_high");
    expect(Number(s.percent_full)).toBeCloseTo(105, 0);
  });

  it("gives a daily reservoir two days before it calls the figures stale", async () => {
    await reservoir();
    await reading(36, { storage: 5, released: 0 });
    await as(db, "anon");
    const s = await one<Signal>(`select * from public.dam_signal('test_res')`);
    expect(s.stale).toBe(false); // 36 hours, inside its own 48
  });
});

describe("what the public may read of all six", () => {
  it("gives a visitor every dam, with how often each reports", async () => {
    await as(db, "anon");
    const all = await rows<{ code: string; feed: string; tambons: number }>(
      db,
      `select code, feed, tambons from public.dam_map()`,
    );
    expect(all.length).toBeGreaterThanOrEqual(6);
    expect(all.map((d) => d.code)).toContain("khlong_sadao");
    expect(new Set(all.map((d) => d.feed))).toEqual(new Set(["hourly", "daily"]));
    // The largest first, so a screen that shows one shows the one that can do the most.
    expect(all[0]!.code).toBe("bang_lang");
    // Khlong Sadao's path runs through Hat Yai; a reservoir with no mapped channel has none.
    expect(Number(all.find((d) => d.code === "khlong_sadao")!.tambons)).toBeGreaterThan(10);
    expect(Number(all.find((d) => d.code === "ban_baik")!.tambons)).toBe(0);
  });

  it("keeps the grade rules out of the public answer", async () => {
    await as(db, "anon");
    const text = JSON.stringify(await rows(db, `select * from public.dam_map()`));
    expect(text).not.toContain("turbine_max_cms");
    expect(text).not.toContain("release_reason");
  });

  it("lets nobody but the job write a reading", async () => {
    await as(db, "anon");
    await expectDenied(
      db,
      `insert into public.dam_readings (dam_code, observed_at, window_h, storage_mcm)
       values ('bang_lang', now() + interval '1 hour', 24, 999)`,
    );
  });
});
