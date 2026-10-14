import type { Map as MapLibreMap, StyleSpecification } from "maplibre-gl";
import { describe, expect, it } from "vitest";
import { PROVINCE_BOUNDS, provincesBox, setBasemap, tambonLinePaint } from "@/lib/map";

describe("the map opens on the provinces of the person's own places", () => {
  it("is the whole province of the chosen area", () => {
    expect(provincesBox(["940101"])).toEqual(PROVINCE_BOUNDS["94"]);
  });

  it("takes in the province of a watched place too (Pattani + Narathiwat)", () => {
    const box = provincesBox(["940101", "960101"])!;
    const [pattani, narathiwat] = [PROVINCE_BOUNDS["94"]!, PROVINCE_BOUNDS["96"]!];
    expect(box).toEqual([
      Math.min(pattani[0], narathiwat[0]),
      Math.min(pattani[1], narathiwat[1]),
      Math.max(pattani[2], narathiwat[2]),
      Math.max(pattani[3], narathiwat[3]),
    ]);
    // Every corner of both provinces is inside it.
    for (const p of [pattani, narathiwat]) {
      expect(box[0]).toBeLessThanOrEqual(p[0]);
      expect(box[1]).toBeLessThanOrEqual(p[1]);
      expect(box[2]).toBeGreaterThanOrEqual(p[2]);
      expect(box[3]).toBeGreaterThanOrEqual(p[3]);
    }
  });

  it("counts a province once, and leaves out codes it does not cover", () => {
    expect(provincesBox(["940101", "940205", "10", null, undefined])).toEqual(
      PROVINCE_BOUNDS["94"],
    );
  });

  it("is nothing without a place, so the map shows all four provinces", () => {
    expect(provincesBox([])).toBeUndefined();
    expect(provincesBox([null, "10"])).toBeUndefined();
  });
});

describe("the tambon outlines on each background", () => {
  /** The tambon line as setBasemap leaves it, coming from a street map. */
  function lineOn(basemap: "streets" | "satellite" | "satelliteTerrain") {
    const previous = {
      version: 8,
      sources: { "jaga-tambons": { type: "geojson", data: "/x" } },
      layers: [
        {
          id: "jaga-tambon-line",
          type: "line",
          source: "jaga-tambons",
          paint: tambonLinePaint(false, false),
        },
      ],
    } as unknown as StyleSpecification;
    let made: StyleSpecification | undefined;
    const map = {
      setStyle: (
        style: StyleSpecification | string,
        options: {
          transformStyle: (p: StyleSpecification, n: StyleSpecification) => StyleSpecification;
        },
      ) => {
        const next: StyleSpecification =
          typeof style === "string" ? { version: 8, sources: {}, layers: [] } : style;
        made = options.transformStyle(previous, next);
      },
    } as unknown as MapLibreMap;
    setBasemap(map, basemap);
    return made!.layers.find((l) => l.id === "jaga-tambon-line") as {
      paint: Record<string, unknown>;
    };
  }

  it("are pale and half see-through on the photographs, so they read without shouting", () => {
    for (const basemap of ["satellite", "satelliteTerrain"] as const) {
      const paint = lineOn(basemap).paint;
      expect(paint["line-color"]).toBe("#f2f5f3");
      expect(paint["line-opacity"]).toBeGreaterThan(0.3);
      expect(paint["line-opacity"]).toBeLessThan(0.7);
    }
  });

  it("stay quiet slate on the street map", () => {
    expect(lineOn("streets").paint).toMatchObject({ "line-color": "#1d3b53", "line-opacity": 0.6 });
  });
});
