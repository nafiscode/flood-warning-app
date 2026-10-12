import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HAZARD_CLASSES,
  HAZARD_OPACITY,
  hazardFillColor,
  hazardKey,
  hazardSourceUrl,
  tilesBase,
} from "@/lib/hazard-layer";

afterEach(() => vi.unstubAllEnvs());

describe("the flood-hazard layer", () => {
  it("draws three classes, highest first, light to dark, in colours that are no alert colour", () => {
    expect(HAZARD_CLASSES.map((c) => c.key)).toEqual(["high", "medium", "low"]);
    expect(HAZARD_CLASSES.map((c) => c.value)).toEqual([4, 3, 2]);
    const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    // Watch, Warning, Evacuate (docs/brand.md): the hues a risk map would otherwise borrow.
    const alert = ["#F2C230", "#F07F1A", "#C62828"].map(rgb);
    for (const c of HAZARD_CLASSES) {
      const [r, g, b] = rgb(c.color) as [number, number, number];
      // Pink to wine: red leads and blue stays above green. Yellow, orange and red all have
      // green at or above blue, so no class can drift into an alert hue unnoticed.
      expect(r).toBeGreaterThan(b);
      expect(b).toBeGreaterThan(g);
      for (const [ar, ag, ab] of alert as [number, number, number][]) {
        expect(Math.hypot(r - ar, g - ag, b - ab)).toBeGreaterThan(60);
      }
    }
    // Light to dark with the class: a higher class is never the paler one.
    const light = HAZARD_CLASSES.map((c) => rgb(c.color).reduce((a, v) => a + v, 0));
    expect(light[0]!).toBeLessThan(light[1]!);
    expect(light[1]!).toBeLessThan(light[2]!);
    // See-through: the streets and names underneath stay readable.
    expect(HAZARD_OPACITY).toBeLessThanOrEqual(0.5);
    expect(HAZARD_OPACITY).toBeGreaterThanOrEqual(0.3);
  });

  it("names a class from the tile's value and nothing for the lowest class or rubbish", () => {
    expect(hazardKey(4)).toBe("high");
    expect(hazardKey("3")).toBe("medium");
    expect(hazardKey(2)).toBe("low");
    expect(hazardKey(1)).toBeNull();
    expect(hazardKey(undefined)).toBeNull();
    const paint = JSON.stringify(hazardFillColor());
    expect(paint).toContain('["get","class"]');
    expect(paint).toContain(HAZARD_CLASSES[0].color);
    expect(paint.endsWith('"rgba(0,0,0,0)"]')).toBe(true);
  });

  it("builds the address only from a real bucket and a manifest that names a file", () => {
    const manifest = {
      layers: { "flood-classes": { key: "hazard/flood-classes/2026-10-12.pmtiles" } },
    };
    expect(hazardSourceUrl("https://tiles.example", manifest)).toBe(
      "pmtiles://https://tiles.example/hazard/flood-classes/2026-10-12.pmtiles",
    );
    expect(hazardSourceUrl(null, manifest)).toBeNull();
    expect(hazardSourceUrl("https://tiles.example", null)).toBeNull();
    expect(hazardSourceUrl("https://tiles.example", { layers: {} })).toBeNull();
    for (const key of [
      "../secret.pmtiles",
      "hazard/x.json",
      "https://evil.example/x.pmtiles",
      "a b.pmtiles",
    ]) {
      expect(
        hazardSourceUrl("https://tiles.example", { layers: { "flood-classes": { key } } }),
      ).toBeNull();
    }
  });

  it("has no tile bucket unless the setting is a web address", () => {
    vi.stubEnv("NEXT_PUBLIC_TILES_BASE_URL", "");
    expect(tilesBase()).toBeNull();
    vi.stubEnv("NEXT_PUBLIC_TILES_BASE_URL", "https://tiles.example/");
    expect(tilesBase()).toBe("https://tiles.example");
    vi.stubEnv("NEXT_PUBLIC_TILES_BASE_URL", "javascript:alert(1)");
    expect(tilesBase()).toBeNull();
  });
});
