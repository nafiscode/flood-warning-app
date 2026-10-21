import { describe, expect, it } from "vitest";
import { damRainCode, damRainPlaces, reservoirCentre } from "@/lib/dam-map";
import { rainClouds } from "@/lib/place-rain";

/** A lake above the dam, and a dam with nothing mapped but its wall. */
const BANG_LANG = {
  code: "bang_lang",
  point: { type: "Point" as const, coordinates: [101.2721, 6.1551] as [number, number] },
  reservoir: {
    type: "Polygon" as const,
    coordinates: [
      [
        [101.2, 6.16],
        [101.3, 6.16],
        [101.3, 6.3],
        [101.2, 6.3],
        [101.2, 6.16],
      ],
      // A hole: Bang Lang's lake has thirteen of them, and they must not move the centre.
      [
        [101.24, 6.2],
        [101.25, 6.2],
        [101.25, 6.21],
        [101.24, 6.2],
      ],
    ],
  },
};

const WALL_ONLY = {
  code: "pattani_weir",
  point: { type: "Point" as const, coordinates: [101.1, 6.7] as [number, number] },
  reservoir: null,
};

describe("rain over a reservoir", () => {
  it("puts the cloud in the middle of the lake's box", () => {
    expect(reservoirCentre(BANG_LANG.reservoir)).toEqual({ lat: 6.23, lon: 101.25 });
    expect(reservoirCentre(null)).toBeNull();
  });

  it("takes the widest part of a MultiPolygon, not the first", () => {
    const at = reservoirCentre({
      type: "MultiPolygon",
      coordinates: [
        [
          [
            [101.0, 6.0],
            [101.01, 6.0],
            [101.01, 6.01],
            [101.0, 6.0],
          ],
        ],
        [
          [
            [101.2, 6.2],
            [101.4, 6.2],
            [101.4, 6.4],
            [101.2, 6.2],
          ],
        ],
      ],
    });
    expect(at!.lat).toBeCloseTo(6.3, 6);
    expect(at!.lon).toBeCloseTo(101.3, 6);
  });

  it("falls back to the dam's own point when no lake is mapped", () => {
    const places = damRainPlaces([BANG_LANG, WALL_ONLY]);
    expect(places).toEqual([
      { id: "dam:bang_lang", lat: 6.23, lon: 101.25, home: false, reservoir: true },
      { id: "dam:pattani_weir", lat: 6.7, lon: 101.1, home: false, reservoir: true },
    ]);
    expect(damRainPlaces([{ code: "nothing", point: null, reservoir: null }])).toEqual([]);
  });

  it("names the dam in the cloud's id, and nothing else", () => {
    expect(damRainCode("dam:bang_lang")).toBe("bang_lang");
    expect(damRainCode("place-7")).toBeNull();
  });

  it("draws a cloud over the lake only while rain is falling there", () => {
    const places = damRainPlaces([BANG_LANG]);
    const wet = rainClouds(places, [{ lat: 6.23, lon: 101.25, code: 95, isDay: true }]);
    expect(wet).toHaveLength(1);
    expect(wet[0]!.kind).toBe("thunder");
    expect(wet[0]!.reservoir).toBe(true);
    expect(rainClouds(places, [{ lat: 6.23, lon: 101.25, code: 0, isDay: true }])).toEqual([]);
  });
});
