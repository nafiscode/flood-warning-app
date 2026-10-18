import { describe, expect, it } from "vitest";
import type { Dam } from "@/lib/dam";
import { damFrame } from "@/lib/dam";
import { boundsAround, MIN_SPAN } from "@/lib/map";
import { RESERVOIR_SPAN, reservoirBox, reservoirFrame } from "@/lib/map-focus";

/** Bang Lang as the map holds it: a dam, two outlets below it, and a lake above. */
const DAM = {
  code: "bang_lang",
  name: { th: "เขื่อนบางลาง", en: "Bang Lang Dam" },
  point: { type: "Point", coordinates: [101.2721, 6.1551] },
  spillwayPoint: { type: "Point", coordinates: [101.2764, 6.1501] },
  outletPoint: { type: "Point", coordinates: [101.273, 6.1536] },
  reservoir: {
    type: "MultiPolygon",
    coordinates: [
      [
        [
          [101.2, 6.16],
          [101.32, 6.16],
          [101.32, 6.32],
          [101.2, 6.32],
          [101.2, 6.16],
        ],
      ],
    ],
  },
  reaches: [],
} as unknown as Dam;

const middle = (box: [number, number, number, number]) => ({
  lon: (box[0] + box[2]) / 2,
  lat: (box[1] + box[3]) / 2,
});
const span = (box: [number, number, number, number]) => ({
  lon: box[2] - box[0],
  lat: box[3] - box[1],
});

describe("where the map goes when a reservoir's button is pressed (owner, 18 Oct)", () => {
  it("frames the reservoir, not the dam and its outlets", () => {
    expect(reservoirFrame(DAM)).toEqual([
      { lon: 101.2, lat: 6.16 },
      { lon: 101.32, lat: 6.32 },
    ]);
    // damFrame holds the dam's own marks as well, which pulls the view downstream.
    expect(damFrame(DAM).length).toBeGreaterThan(reservoirFrame(DAM).length);
  });

  it("puts the lake in the middle of the map", () => {
    const box = reservoirBox(DAM)!;
    expect(middle(box).lon).toBeCloseTo(101.26, 4);
    expect(middle(box).lat).toBeCloseTo(6.24, 4);
  });

  it("is a closer look than the dam's own view", () => {
    const close = span(reservoirBox(DAM)!);
    const wide = span(boundsAround(damFrame(DAM))!);
    expect(close.lon).toBeLessThan(wide.lon);
    expect(close.lat).toBeLessThan(wide.lat);
  });

  it("keeps a little country around a small reservoir rather than zooming to its surface", () => {
    const pond = {
      ...DAM,
      reservoir: {
        type: "Polygon",
        coordinates: [
          [
            [101.25, 6.2],
            [101.26, 6.2],
            [101.26, 6.21],
            [101.25, 6.2],
          ],
        ],
      },
    } as unknown as Dam;
    const box = reservoirBox(pond)!;
    expect(span(box).lon).toBeGreaterThanOrEqual(RESERVOIR_SPAN.lon);
    // Still closer than the map's ordinary floor, which is a whole neighbourhood.
    expect(span(box).lon).toBeLessThan(MIN_SPAN.lon);
  });

  it("falls back to the dam itself where no lake is mapped", () => {
    const noLake = { ...DAM, reservoir: null } as unknown as Dam;
    expect(reservoirFrame(noLake)).toEqual([{ lon: 101.2721, lat: 6.1551 }]);
    expect(reservoirBox(noLake)).toBeDefined();
  });
});
