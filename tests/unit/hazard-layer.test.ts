import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HAZARD_CLASSES,
  hazardFillColor,
  hazardKey,
  hazardSourceUrl,
  tilesBase,
} from "@/lib/hazard-layer";

afterEach(() => vi.unstubAllEnvs());

describe("the flood-hazard layer", () => {
  it("draws three classes, highest first, in purples that are no alert colour", () => {
    expect(HAZARD_CLASSES.map((c) => c.key)).toEqual(["high", "medium", "low"]);
    expect(HAZARD_CLASSES.map((c) => c.value)).toEqual([4, 3, 2]);
    const alert = ["#2F7A25", "#F2C230", "#F07F1A", "#C62828", "#1F6FD1", "#6B7780"];
    for (const c of HAZARD_CLASSES) {
      expect(alert).not.toContain(c.color.toUpperCase());
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.color.slice(i, i + 2), 16)) as [
        number,
        number,
        number,
      ];
      // Purple: blue leads, red follows, green is the least. No alert hue has that order.
      expect(b).toBeGreaterThan(r);
      expect(r).toBeGreaterThan(g);
    }
    // Light to dark with the class: a higher class is never the paler one.
    const light = HAZARD_CLASSES.map((c) => parseInt(c.color.slice(3, 5), 16));
    expect(light[0]!).toBeLessThan(light[1]!);
    expect(light[1]!).toBeLessThan(light[2]!);
  });

  it("names a class from the tile's value and nothing for the lowest class or rubbish", () => {
    expect(hazardKey(4)).toBe("high");
    expect(hazardKey("3")).toBe("medium");
    expect(hazardKey(2)).toBe("low");
    expect(hazardKey(1)).toBeNull();
    expect(hazardKey(undefined)).toBeNull();
    const paint = JSON.stringify(hazardFillColor());
    expect(paint).toContain('["get","class"]');
    expect(paint).toContain("#5A2A8C");
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
