import { describe, expect, it } from "vitest";
import { aggregatePlaceHazard, type HazardRow } from "@/lib/place-hazard";
import { riskHeadline } from "@/lib/tambon-risk";

/**
 * Summing a place's tambons into one flood-hazard figure (19 Nov 2026).
 *
 * The weighting is the whole point. A district's tambons differ in size by a factor of fifty, so
 * an average of their percentages would be wrong in a way nobody would ever notice by reading the
 * page - it would simply be a plausible number. These cases are built so that the area-weighted
 * answer and the naive average are far apart, and assert the weighted one.
 */

const row = (over: Partial<Record<keyof HazardRow, number | string>> = {}): HazardRow => ({
  tambon_code: "940101",
  land_km2: 10,
  high_km2: 1,
  medium_km2: 1,
  low_km2: 2,
  minimal_km2: 6,
  buildings: 100,
  high_buildings: 10,
  medium_buildings: 10,
  ...over,
});

describe("aggregatePlaceHazard", () => {
  it("weights land by area, not by counting each tambon the same", () => {
    // One big tambon almost entirely Minimal, one tiny one entirely High.
    const big = row({ land_km2: 99, high_km2: 0, medium_km2: 0, low_km2: 0, minimal_km2: 99 });
    const tiny = row({ land_km2: 1, high_km2: 1, medium_km2: 0, low_km2: 0, minimal_km2: 0 });
    const got = aggregatePlaceHazard("9401", [big, tiny])!;
    // Weighted: 1 km² of 100 is High. An average of the two tambons' shares would say 50%.
    expect(Math.round(got.land.high)).toBe(1);
    expect(Math.round(got.land.minimal)).toBe(99);
  });

  it("weights buildings by count, not by the mean of each tambon's share", () => {
    // A small tambon where everything is at risk, a large one where nothing is.
    const risky = row({ buildings: 10, high_buildings: 10, medium_buildings: 0 });
    const safe = row({ buildings: 990, high_buildings: 0, medium_buildings: 0 });
    const got = aggregatePlaceHazard("9401", [risky, safe])!;
    // 10 of 1,000 buildings = 1%. The mean of the two shares would be 50%.
    expect(Math.round(got.buildingsAtRisk ?? -1)).toBe(1);
    expect(got.buildings).toBe(1000);
  });

  it("fills the bar exactly, so no sliver of 'not stated' appears that the data never said", () => {
    const got = aggregatePlaceHazard("9401", [row(), row()])!;
    const total = got.land.high + got.land.medium + got.land.low + got.land.minimal;
    expect(Math.round(total)).toBe(100);
  });

  it("carries the place's own code, not a tambon's", () => {
    expect(aggregatePlaceHazard("90", [row()])!.code).toBe("90");
    expect(aggregatePlaceHazard("9011", [row()])!.code).toBe("9011");
  });

  it("is null where the place has no rows at all", () => {
    expect(aggregatePlaceHazard("9401", [])).toBeNull();
  });

  it("says 'not stated', never 'no risk', when nothing is known (safety rule 10)", () => {
    // Nothing known means nothing: no class area *and* no building counted on marked land. With
    // buildings at risk still counted the card rightly leads on them instead, which is why they
    // are zeroed here rather than left at the fixture's defaults.
    const blank = row({
      land_km2: 0,
      high_km2: 0,
      medium_km2: 0,
      low_km2: 0,
      minimal_km2: 0,
      high_buildings: 0,
      medium_buildings: 0,
    });
    const got = aggregatePlaceHazard("9401", [blank])!;
    expect(got.land.minimal).toBe(100);
    expect(got.land.high).toBe(0);
    // And the card then leads on the sentence that says so rather than on a figure.
    expect(riskHeadline(got)).toBe("little");
  });

  it("leaves the building share null rather than 0% where none were counted", () => {
    const none = row({ buildings: 0, high_buildings: 0, medium_buildings: 0 });
    const got = aggregatePlaceHazard("9401", [none])!;
    // A bare 0% would read as an all-clear; null makes the card lead on land instead.
    expect(got.buildingsAtRisk).toBeNull();
  });

  it("ignores rubbish in a row rather than letting it poison the sum", () => {
    const bad = { ...row(), land_km2: "x", high_km2: null, buildings: -5 } as HazardRow;
    const got = aggregatePlaceHazard("9401", [row(), bad])!;
    expect(Number.isFinite(got.land.high)).toBe(true);
    expect(got.buildings).toBe(100);
  });

  it("never lets a share exceed 100", () => {
    const odd = row({ buildings: 10, high_buildings: 90, medium_buildings: 90 });
    expect(aggregatePlaceHazard("9401", [odd])!.buildingsAtRisk).toBeLessThanOrEqual(100);
  });
});
