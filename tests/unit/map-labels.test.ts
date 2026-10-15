import { describe, expect, it } from "vitest";
import {
  CAPITAL_LAYER,
  detailZoom,
  labelMinzoom,
  labelsToLift,
  PROVINCE_LINE_LAYER,
  quietOverview,
  TAMBON_LINE_LAYER,
} from "@/lib/map";

const L = (id: string, type: string) => ({ id, type });

describe("the basemap's place names over our fills (owner, 13 Oct)", () => {
  const before = [
    L("water", "fill"),
    L("place-village", "symbol"),
    L("place-town", "symbol"),
    L("jaga-base-hillshade", "hillshade"),
    L("jaga-tambon-fill", "fill"),
    L("jaga-hazard-fill", "fill"),
    L("jaga-alert-fill", "fill"),
    L("jaga-tambon-line", "line"),
    L("jaga-mine-label", "symbol"),
  ];

  it("names under the risk shading, the alert colours or the hill shading are lifted, in order", () => {
    expect(labelsToLift(before, "jaga-tambon-line")).toEqual(["place-village", "place-town"]);
  });

  it("once they sit directly under our outlines there is nothing more to move", () => {
    const after = [
      L("water", "fill"),
      L("jaga-base-hillshade", "hillshade"),
      L("jaga-tambon-fill", "fill"),
      L("jaga-hazard-fill", "fill"),
      L("jaga-alert-fill", "fill"),
      L("place-village", "symbol"),
      L("place-town", "symbol"),
      L("jaga-tambon-line", "line"),
      L("jaga-mine-label", "symbol"),
    ];
    expect(labelsToLift(after, "jaga-tambon-line")).toEqual([]);
  });

  it("a fill added later, between the names and the outlines, sends them up again", () => {
    const later = [
      L("place-village", "symbol"),
      L("jaga-reports", "fill"),
      L("jaga-tambon-line", "line"),
    ];
    expect(labelsToLift(later, "jaga-tambon-line")).toEqual(["place-village"]);
  });

  it("our own names are never moved, and a map with no names or no outlines is left alone", () => {
    expect(
      labelsToLift(
        [L("jaga-base-satellite", "raster"), L("jaga-tambon-line", "line")],
        "jaga-tambon-line",
      ),
    ).toEqual([]);
    expect(labelsToLift([L("place-village", "symbol")], "jaga-tambon-line")).toEqual([]);
  });
});

describe("the four provinces at a glance (owner, 15 Oct)", () => {
  type Layer = { id: string; type: string; minzoom?: number; maxzoom?: number };
  const fakeMap = (overview: number, layers: Layer[]) => {
    const byId = new Map(layers.map((l) => [l.id, { ...l }]));
    const calls: [string, number, number][] = [];
    return {
      calls,
      byId,
      map: {
        cameraForBounds: () => ({ zoom: overview }),
        getLayer: (id: string) => {
          const l = byId.get(id);
          return l && { minzoom: l.minzoom ?? 0, maxzoom: l.maxzoom ?? 24 };
        },
        getStyle: () => ({ layers: [...byId.values()] }),
        setLayerZoomRange: (id: string, min: number, max: number) => {
          calls.push([id, min, max]);
          Object.assign(byId.get(id)!, { minzoom: min, maxzoom: max });
        },
      } as unknown as Parameters<typeof quietOverview>[0],
    };
  };

  it("brings the detail back a little past the overview", () => {
    expect(detailZoom(6.7)).toBe(7.1);
    expect(labelMinzoom(undefined, 7.1)).toBe(7.1);
    expect(labelMinzoom(12, 7.1)).toBe(12);
  });

  it("hides tambon outlines and the basemap's names, and shows the capitals, at the overview", () => {
    const f = fakeMap(7, [
      L(TAMBON_LINE_LAYER, "line"),
      L(CAPITAL_LAYER, "symbol"),
      L(PROVINCE_LINE_LAYER, "line"),
      L("place-city", "symbol"),
      { id: "place-village", type: "symbol", minzoom: 11 },
      L("water", "fill"),
    ]);
    quietOverview(f.map);
    expect(f.byId.get(TAMBON_LINE_LAYER)!.minzoom).toBe(7.4);
    expect(f.byId.get(CAPITAL_LAYER)!.maxzoom).toBe(7.4);
    expect(f.byId.get("place-city")!.minzoom).toBe(7.4);
    // A name that already waits longer keeps its own zoom; outlines and fills are untouched.
    expect(f.byId.get("place-village")!.minzoom).toBe(11);
    expect(f.byId.get(PROVINCE_LINE_LAYER)!.minzoom).toBeUndefined();
    expect(f.byId.get("water")!.minzoom).toBeUndefined();
    // Asking again changes nothing.
    const n = f.calls.length;
    quietOverview(f.map);
    expect(f.calls.length).toBe(n);
  });
});
