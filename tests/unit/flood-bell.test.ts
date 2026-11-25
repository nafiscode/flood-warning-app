import { describe, expect, it } from "vitest";
import { bankReachedNear } from "@/lib/flood-scene";
import type { GaugeReading } from "@/lib/map-data";
import { buildNotices } from "@/lib/notices";

/*
 * The bell's "a river near you has reached its bank" (24 Nov 2026). Two things are kept honest: a
 * station is picked only when it is at or over its bank AND near one of the person's places AND
 * named (a station the summary did not name cannot be shown); and the bell item is a measurement,
 * one standing line per river, never an alert.
 */

const YALA = { lat: 6.54, lon: 101.28 }; // the person's area

function reading(over: Partial<GaugeReading>): GaugeReading {
  return {
    lat: 6.54,
    lon: 101.28,
    status: "above_evacuate",
    observedAt: "2026-11-24T06:00:00Z",
    rise3h: 0.2,
    roseDays: 3,
    id: "X.40A",
    name: { th: "ปัตตานีที่ยะลา", en: "Pattani at Yala" },
    ...over,
  };
}

describe("bankReachedNear", () => {
  it("picks a named river at its bank near the person", () => {
    const got = bankReachedNear([reading({})], [YALA]);
    expect(got).toEqual([{ id: "X.40A", name: { th: "ปัตตานีที่ยะลา", en: "Pattani at Yala" }, at: "2026-11-24T06:00:00Z" }]);
  });

  it("ignores a river that is only near its bank, not over it", () => {
    expect(bankReachedNear([reading({ status: "above_warning" })], [YALA])).toEqual([]);
  });

  it("ignores a bank-reached river that is far from every place", () => {
    // Hat Yai is ~130 km from Yala, well past GAUGES_NEAR_KM.
    expect(bankReachedNear([reading({ lat: 7.0, lon: 100.47 })], [YALA])).toEqual([]);
  });

  it("ignores a bank-reached station the summary did not name", () => {
    // A river the feed did not name cannot be shown; it is left out, never guessed.
    expect(bankReachedNear([reading({ id: undefined, name: undefined })], [YALA])).toEqual([]);
  });

  it("gives nothing when the person has saved no place", () => {
    expect(bankReachedNear([reading({})], [])).toEqual([]);
  });

  it("names each river once, even if the feed repeats it", () => {
    expect(bankReachedNear([reading({}), reading({})], [YALA])).toHaveLength(1);
  });
});

describe("buildNotices with bankReached", () => {
  const base = {
    rows: [],
    area: null,
    me: null,
    cases: [],
    now: Date.parse("2026-11-24T06:10:00Z"),
    homeLabel: "home",
    areaLabel: () => "area",
  };

  it("adds one standing measurement item per river, keyed on the gauge", () => {
    const items = buildNotices({
      ...base,
      bankReached: [{ id: "X.40A", name: { th: "ยะลา", en: "Yala" }, at: "2026-11-24T06:00:00Z" }],
    });
    const item = items.find((i) => i.kind === "bankReached");
    expect(item).toBeDefined();
    expect(item?.id).toBe("bank:X.40A");
    if (item?.kind === "bankReached") expect(item.gaugeId).toBe("X.40A");
  });

  it("drops a river whose reading is older than the fourteen-day window", () => {
    const items = buildNotices({
      ...base,
      bankReached: [{ id: "X.OLD", name: { th: "เก่า", en: "Old" }, at: "2026-10-01T00:00:00Z" }],
    });
    expect(items.some((i) => i.kind === "bankReached")).toBe(false);
  });
});
