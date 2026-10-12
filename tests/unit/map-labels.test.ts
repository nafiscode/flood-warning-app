import { describe, expect, it } from "vitest";
import { labelsToLift } from "@/lib/map";

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
