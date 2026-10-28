import { describe, expect, it } from "vitest";
import { DAM_WATER, DAM_WATER_DARK } from "@/lib/dam-map";
import {
  RIVER_OPACITY,
  RIVER_OPACITY_NIGHT,
  riverColor,
  riverSourceUrl,
} from "@/lib/river-layer";

describe("the river-body layer", () => {
  it("wears the map's water colour, by day and by night, never an alert colour", () => {
    expect(riverColor(false)).toBe(DAM_WATER);
    expect(riverColor(true)).toBe(DAM_WATER_DARK);
    const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    // Watch, Warning, Evacuate (docs/brand.md): a water colour must sit well clear of them.
    const alert = ["#F2C230", "#F07F1A", "#C62828"].map(rgb);
    for (const water of [DAM_WATER, DAM_WATER_DARK]) {
      const [r, g, b] = rgb(water) as [number, number, number];
      // Blue leads: a water colour has blue above red, the opposite of every warm alert hue.
      expect(b).toBeGreaterThan(r);
      for (const [ar, ag, ab] of alert as [number, number, number][]) {
        expect(Math.hypot(r - ar, g - ag, b - ab)).toBeGreaterThan(60);
      }
    }
    // See-through: the streets and names underneath stay readable.
    expect(RIVER_OPACITY).toBeLessThanOrEqual(0.7);
    expect(RIVER_OPACITY_NIGHT).toBeLessThanOrEqual(RIVER_OPACITY);
  });

  it("builds the address only from a real bucket and a manifest that names a file", () => {
    const manifest = { layers: { "river-body": { key: "hazard/river-body/2026-10-28.pmtiles" } } };
    expect(riverSourceUrl("https://tiles.example", manifest)).toBe(
      "pmtiles://https://tiles.example/hazard/river-body/2026-10-28.pmtiles",
    );
    expect(riverSourceUrl(null, manifest)).toBeNull();
    expect(riverSourceUrl("https://tiles.example", null)).toBeNull();
    expect(riverSourceUrl("https://tiles.example", { layers: {} })).toBeNull();
    for (const key of ["../secret.pmtiles", "hazard/x.json", "a b.pmtiles"]) {
      expect(
        riverSourceUrl("https://tiles.example", { layers: { "river-body": { key } } }),
      ).toBeNull();
    }
  });
});
