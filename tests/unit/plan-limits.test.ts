import { describe, expect, it } from "vitest";
import {
  adviseService,
  estimateMeter,
  inFloodSeason,
  meterDef,
  METERS,
  parseAmount,
  pushSignature,
  type PlanReading,
} from "@/lib/plan-limits";

const NOW = new Date("2026-11-27T12:00:00Z");

function reading(meter: string, value: number, at: string, over: Partial<PlanReading> = {}) {
  const def = meterDef(meter)!;
  return { service: def.service, meter, value, at, resetsOn: null, note: null, ...over };
}

describe("what a typed amount means", () => {
  it("reads hours as the dashboards write them", () => {
    expect(parseAmount("3h 12m", "hours")).toBeCloseTo(3.2);
    expect(parseAmount("1h 52m", "hours")).toBeCloseTo(1.8667, 3);
    expect(parseAmount("3:30", "hours")).toBe(3.5);
    expect(parseAmount("3.25", "hours")).toBe(3.25);
    expect(parseAmount("3,25", "hours")).toBe(3.25);
    expect(parseAmount("45m", "hours")).toBe(0.75);
  });
  it("reads counts with k and M", () => {
    expect(parseAmount("192k", "count")).toBe(192_000);
    expect(parseAmount("1.2M", "count")).toBe(1_200_000);
    expect(parseAmount("94000", "count")).toBe(94_000);
    expect(parseAmount("94 GB", "count")).toBeNull();
  });
  it("reads sizes in either unit", () => {
    expect(parseAmount("3.6 GB", "gb")).toBe(3.6);
    expect(parseAmount("800 MB", "gb")).toBe(0.8);
    expect(parseAmount("71 MB", "mb")).toBe(71);
    expect(parseAmount("0.3 GB", "mb")).toBe(300);
  });
  it("refuses what is not a number", () => {
    expect(parseAmount("", "gb")).toBeNull();
    expect(parseAmount("a lot", "gb")).toBeNull();
    expect(parseAmount("-3", "gb")).toBeNull();
  });
});

describe("the flood season", () => {
  it("is October to December, by Bangkok's calendar", () => {
    expect(inFloodSeason(new Date("2026-11-27T12:00:00Z"))).toBe(true);
    expect(inFloodSeason(new Date("2026-09-30T18:00:00Z"))).toBe(true); // 1 Oct in Bangkok
    expect(inFloodSeason(new Date("2026-06-15T12:00:00Z"))).toBe(false);
  });
});

describe("one cycle meter", () => {
  it("projects from the cycle's start when the reset date is known", () => {
    // 3.0 h of 4 on 27 Nov, the cycle ending 1 Dec: it began 1 Nov, so 26 days gone.
    const e = estimateMeter(
      meterDef("active_cpu")!,
      [reading("active_cpu", 3, "2026-11-27T12:00:00Z", { resetsOn: "2026-12-01" })],
      NOW,
    );
    expect(e.share).toBe(0.75);
    expect(e.status).toBe("act");
    expect(e.perDay!.low).toBeCloseTo(3 / 26.5, 2);
    // At that pace the cycle ends near 3.4 h, and with the flood margin, past the limit's 4 h.
    expect(e.endShare!.low).toBeLessThan(1);
    expect(e.endShare!.high).toBeGreaterThan(e.endShare!.low);
  });

  it("says the limit lands after the reset when the pace is slow, and in which cycle", () => {
    const e = estimateMeter(
      meterDef("egress")!,
      [reading("egress", 1.24, "2026-10-24T12:00:00Z", { resetsOn: "2026-10-28" })],
      new Date("2026-10-24T12:00:00Z"),
    );
    expect(e.status).toBe("ok");
    expect(e.limitOn).toBeNull();
  });

  it("uses two readings in the cycle for the recent pace", () => {
    const e = estimateMeter(
      meterDef("egress")!,
      [
        reading("egress", 1, "2026-11-10T00:00:00Z", { resetsOn: "2026-11-28" }),
        reading("egress", 2.5, "2026-11-20T00:00:00Z", { resetsOn: "2026-11-28" }),
      ],
      new Date("2026-11-20T00:00:00Z"),
    );
    // 0.15 GB a day recently; the 5 GB limit is 2.5 GB away, so about 17 days: after the reset.
    expect(e.perDay!.high).toBeCloseTo(0.15 * 1.5, 3);
    expect(e.endShare!.high).toBeGreaterThan(e.endShare!.low);
  });

  it("starts over when the counter has gone down", () => {
    const e = estimateMeter(
      meterDef("transfer")!,
      [
        reading("transfer", 60, "2026-10-20T00:00:00Z"),
        reading("transfer", 2, "2026-11-03T00:00:00Z"),
        reading("transfer", 6, "2026-11-13T00:00:00Z"),
      ],
      new Date("2026-11-13T00:00:00Z"),
    );
    expect(e.latest!.value).toBe(6);
    expect(e.perDay!.low).toBeCloseTo(0.4, 3);
    expect(e.status).toBe("ok");
  });

  it("flags a stale reading, and no reading at all", () => {
    const old = estimateMeter(
      meterDef("transfer")!,
      [reading("transfer", 3.6, "2026-10-24T00:00:00Z")],
      NOW,
    );
    expect(old.stale).toBe(true);
    expect(estimateMeter(meterDef("transfer")!, [], NOW).status).toBe("none");
  });
});

describe("a stock meter and a flag", () => {
  it("projects the database's growth and turns to act inside a month of its line", () => {
    // 300 MB is the line; 250 MB on 1 Nov rising 2 MB a day is 304 MB on 27 Nov... take 260 -> 290.
    const e = estimateMeter(
      meterDef("db_size")!,
      [
        reading("db_size", 230, "2026-11-01T00:00:00Z"),
        reading("db_size", 260, "2026-11-16T00:00:00Z"),
      ],
      new Date("2026-11-16T00:00:00Z"),
    );
    expect(e.perDay!.low).toBeCloseTo(2, 3);
    expect(e.triggerOn!.latest >= e.triggerOn!.soonest).toBe(true);
    expect(e.status).toBe("act");
  });

  it("treats the provider's warning as an upgrade line for a fortnight, then lets it go", () => {
    const warned = [reading("disk_io", 1, "2026-11-27T00:00:00Z")];
    expect(estimateMeter(meterDef("disk_io")!, warned, NOW).status).toBe("act");
    const later = new Date("2026-12-20T00:00:00Z");
    expect(estimateMeter(meterDef("disk_io")!, warned, later).status).toBe("ok");
  });
});

describe("the advice for a service", () => {
  it("says now when a meter is at its upgrade line", () => {
    const a = adviseService(
      "vercel",
      [reading("active_cpu", 3, "2026-11-27T00:00:00Z", { resetsOn: "2026-12-01" })],
      NOW,
    );
    expect(a.verdict).toBe("now");
    expect(a.because.map((m) => m.def.id)).toEqual(["active_cpu"]);
    expect(a.upgradeBy).not.toBeNull();
    expect(a.blind).toBe(false);
  });

  it("says soon in the flood season when something is past half, and later out of it", () => {
    const readings = [reading("transfer", 55, "2026-11-26T00:00:00Z", { resetsOn: "2026-12-26" })];
    // 55 GB is past half the limit but under the upgrade line of 50%? It is past it: act.
    const inSeason = adviseService(
      "vercel",
      [reading("cdn_requests", 400_000, "2026-11-26T00:00:00Z", { resetsOn: "2026-12-26" })],
      NOW,
    );
    expect(["soon", "now"]).toContain(inSeason.verdict);
    expect(adviseService("vercel", readings, NOW).verdict).toBe("now");
    const summer = new Date("2026-06-15T12:00:00Z");
    const quiet = adviseService(
      "vercel",
      [reading("cdn_requests", 100_000, "2026-06-14T00:00:00Z", { resetsOn: "2026-07-01" })],
      summer,
    );
    expect(quiet.verdict).toBe("later");
  });

  it("calls itself blind when nothing fresh was read", () => {
    const a = adviseService("supabase", [], NOW);
    expect(a.blind).toBe(true);
    expect(a.verdict).toBe("later");
  });

  it("holds every meter to one service, and every limit above nought but a flag", () => {
    expect(new Set(METERS.map((m) => m.id)).size).toBe(METERS.length);
    for (const m of METERS) if (m.kind !== "flag") expect(m.limit).toBeGreaterThan(0);
  });
});

describe("marking a service as upgraded, and the push", () => {
  const critical = [reading("active_cpu", 3, "2026-11-27T00:00:00Z", { resetsOn: "2026-12-01" })];

  it("stops advising once an admin has said the plan is upgraded", () => {
    const marked = [...critical, reading("vercel_upgraded", 1, "2026-11-28T00:00:00Z")];
    const a = adviseService("vercel", marked, new Date("2026-11-29T00:00:00Z"));
    expect(a.verdict).toBe("done");
    expect(a.upgradedOn).toBe("2026-11-28");
    expect(pushSignature(a, NOW)).toBeNull();
    // Saying no again takes the mark back.
    const undone = [...marked, reading("vercel_upgraded", 0, "2026-11-29T00:00:00Z")];
    expect(adviseService("vercel", undone, new Date("2026-11-29T12:00:00Z")).verdict).toBe("now");
    // One service's mark does not cover the other.
    expect(adviseService("supabase", marked, NOW).upgradedOn).toBeNull();
  });

  it("asks for a push only at 'now', once per episode and two days", () => {
    const a = adviseService("vercel", critical, NOW);
    const first = pushSignature(a, NOW)!;
    expect(first).toMatch(/^active_cpu:\d+$/);
    expect(pushSignature(a, new Date(NOW.getTime() + 3_600_000))).toBe(first);
    expect(pushSignature(a, new Date(NOW.getTime() + 3 * 86_400_000))).not.toBe(first);
    const quiet = adviseService(
      "vercel",
      [reading("cdn_requests", 10_000, "2026-11-27T00:00:00Z", { resetsOn: "2026-12-26" })],
      NOW,
    );
    expect(pushSignature(quiet, NOW)).toBeNull();
  });

  it("names a new meter at the line as a new episode", () => {
    const one = adviseService("vercel", critical, NOW);
    const two = adviseService(
      "vercel",
      [...critical, reading("transfer", 60, "2026-11-27T00:00:00Z", { resetsOn: "2026-12-26" })],
      NOW,
    );
    expect(pushSignature(two, NOW)).not.toBe(pushSignature(one, NOW));
  });
});
