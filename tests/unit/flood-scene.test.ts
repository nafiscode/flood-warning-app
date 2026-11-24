import { describe, expect, it } from "vitest";
import { canPlayScene, overBankMetres, sceneIsLive } from "@/lib/flood-scene";
import type { Gauge } from "@/lib/map-data";

/** A gauge whose bank (Evacuate) is 5.00 m; the reading is set per test. */
function gauge(over: Partial<Gauge>): Gauge {
  return {
    id: "X.TEST",
    name: { th: "ทดสอบ", en: "Test" },
    lat: 6.8,
    lon: 101.2,
    value: null,
    observedAt: "2026-11-24T06:00:00Z",
    status: "above_evacuate",
    watch: 3,
    warning: 4,
    evacuate: 5,
    bank: 5,
    provisionalLevels: true,
    ...over,
  };
}

describe("flood-scene", () => {
  it("reports how far a reading stands over the bank, to the centimetre", () => {
    expect(overBankMetres(gauge({ value: 5.37 }))).toBe(0.37);
    expect(canPlayScene(gauge({ value: 5.37 }))).toBe(true);
  });

  it("gives null when the river is below its bank", () => {
    expect(overBankMetres(gauge({ value: 4.9, status: "above_warning" }))).toBeNull();
    expect(canPlayScene(gauge({ value: 4.9, status: "above_warning" }))).toBe(false);
  });

  it("treats a reading exactly at the bank as reached", () => {
    expect(overBankMetres(gauge({ value: 5.0 }))).toBe(0);
    expect(canPlayScene(gauge({ value: 5.0 }))).toBe(true);
  });

  it("never opens the scene for a stale or silent gauge, whatever its last reading was", () => {
    // A dead sensor's last figure must not open a flood scene (safety rule 10; the 22 Nov 2026
    // frozen-sensor bug).
    expect(sceneIsLive(gauge({ value: 6.2, status: "no_recent_data" }))).toBe(false);
    expect(overBankMetres(gauge({ value: 6.2, status: "no_recent_data" }))).toBeNull();
    expect(canPlayScene(gauge({ value: 6.2, status: "no_recent_data" }))).toBe(false);
  });

  it("gives null when there is no bank to measure against", () => {
    expect(
      overBankMetres(
        gauge({ value: 6, bank: null, evacuate: null, warning: null, watch: null }),
      ),
    ).toBeNull();
  });

  it("uses the lower of two listed banks (the side the river leaves first)", () => {
    // Left bank 5.10, right 5.40 on the same datum as the levels: the river is over the left at
    // 5.20 though still inside the right.
    const g = gauge({ value: 5.2, leftBank: 5.1, rightBank: 5.4, bank: null, evacuate: 5.5 });
    expect(overBankMetres(g)).toBe(0.1);
  });
});
