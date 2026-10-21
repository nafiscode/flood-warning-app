/**
 * RLS tests for the flood pages' one database read (A10, 21 Oct 2026).
 *
 * `area_public_summary()` is called by a page a crawler and an anonymous visitor both reach, so
 * what matters is that it tells a visitor nothing a visitor could not already read, and that its
 * figures are the ones the public map shows rather than figures of its own.
 *
 * Its first version was `security definer`, corrected an hour later
 * (20261021183000_a10_province_summary_invoker.sql): a definer bypasses row-level security and so
 * counted safe places an admin had rejected, which the public map excludes. The last test here is
 * that correction held in place - it rejects a place and expects the count to drop.
 */
import type { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { as, asOwner, connect, rows } from "./db";

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

type Summary = {
  code: string;
  generatedAt: string;
  tambons: number;
  gauges: { code: string; status: string; value: number | null }[];
  tambonList: { code: string; nameTh: string; nameEn: string }[] | null;
  places: { total: number; verified: number };
};

const summary = async (code: string): Promise<Summary> =>
  (await rows<{ s: Summary }>(db, "select public.area_public_summary($1) as s", [code]))[0]!.s;

const HAT_YAI = "9011";

describe("a visitor (anon) reading one area", () => {
  beforeEach(async () => as(db, "anon"));

  it("may call it for each of the four covered provinces", async () => {
    for (const province of ["90", "94", "95", "96"]) {
      const found = await summary(province);
      expect(found.code).toBe(province);
      expect(found.tambons).toBeGreaterThan(0);
      expect(found.places.total).toBeGreaterThan(0);
      // A province gets no tambon list: over a hundred names would be noise.
      expect(found.tambonList).toBeNull();
    }
  });

  it("may call it for a district, which gets its own tambons by name", async () => {
    const found = await summary(HAT_YAI);
    expect(found.tambons).toBe(13);
    expect(found.tambonList).toHaveLength(13);
    expect(found.tambonList!.map((t) => t.nameTh)).toContain("หาดใหญ่");
    for (const tambon of found.tambonList!) expect(tambon.code.startsWith(HAT_YAI)).toBe(true);
  });

  it("gives a district only what stands inside it, not its province's share", async () => {
    const songkhla = await summary("90");
    const hatYai = await summary(HAT_YAI);
    expect(hatYai.tambons).toBeLessThan(songkhla.tambons);
    expect(hatYai.places.total).toBeLessThan(songkhla.places.total);
    expect(hatYai.gauges.length).toBeLessThanOrEqual(songkhla.gauges.length);
    // Every gauge Hat Yai claims is one Songkhla claims too.
    const inProvince = new Set(songkhla.gauges.map((gauge) => gauge.code));
    for (const gauge of hatYai.gauges) expect(inProvince.has(gauge.code)).toBe(true);
  });

  it("gives a province no gauge that stands outside it", async () => {
    const pattani = await summary("94");
    const yala = await summary("95");
    const shared = pattani.gauges
      .map((gauge) => gauge.code)
      .filter((code) => yala.gauges.some((gauge) => gauge.code === code));
    expect(shared).toEqual([]);
  });

  it("answers for somewhere Jaga does not cover with nothing, not an error", async () => {
    // Phuket, and a district of it. There is no page for either, but neither may throw.
    for (const code of ["83", "8301"]) {
      const found = await summary(code);
      expect(found.gauges).toEqual([]);
      expect(found.tambons).toBe(0);
      expect(found.places).toEqual({ total: 0, verified: 0 });
    }
  });

  it("carries no exact location, no station id and nothing personal", async () => {
    const found = await summary("94");
    const text = JSON.stringify(found);
    for (const leak of ["lat", "lon", "point", "phone", "\"id\""]) {
      expect(text, `summary must not carry ${leak}`).not.toContain(leak);
    }
  });

  it("grades a gauge by a word, never by the gauge levels themselves", async () => {
    const text = JSON.stringify(await summary("94"));
    for (const level of ["watch_m", "warning_m", "evacuate_m"]) {
      expect(text).not.toContain(level);
    }
    for (const gauge of (await summary("94")).gauges) {
      expect([
        "normal",
        "above_watch",
        "above_warning",
        "above_evacuate",
        "no_levels",
        "no_recent_data",
      ]).toContain(gauge.status);
    }
  });
});

describe("the safe-place count is the public map's count", () => {
  it("drops when an admin rejects a place, as the map's does", async () => {
    await as(db, "anon");
    const before = (await summary("94")).places.total;

    // Reject one of Pattani's safe places as the owner, then look again as a visitor.
    await asOwner(db);
    const picked = await rows<{ id: string }>(
      db,
      `select id from public.safe_places
       where tambon is not null and left(tambon, 2) = '94' and verification_status <> 'rejected'
       limit 1`,
    );
    expect(picked.length).toBe(1);
    await db.query("update public.safe_places set verification_status = 'rejected' where id = $1", [
      picked[0]!.id,
    ]);

    await as(db, "anon");
    expect((await summary("94")).places.total).toBe(before - 1);
  });
});
