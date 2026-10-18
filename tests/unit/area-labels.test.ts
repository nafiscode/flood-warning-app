import { describe, expect, it } from "vitest";
import { areaLabelFeatures, areaLabels } from "@/lib/area-labels";
import { labelSteps, beforeBasemapLabels, DETAIL_STEP } from "@/lib/map";
import type { TambonEntry } from "@/lib/area";

const entry = (over: Partial<TambonEntry>): TambonEntry => ({
  code: "940111",
  nameTh: "ตะลุโบะ",
  nameEn: "Talubo",
  districtCode: "9401",
  districtTh: "เมืองปัตตานี",
  districtEn: "Mueang Pattani",
  provinceCode: "94",
  lat: 6.86,
  lon: 101.26,
  ...over,
});

describe("the names of the areas on the map (owner, 18 Oct)", () => {
  const tambons = [
    entry({}),
    entry({ code: "940112", nameTh: "บานา", nameEn: "Bana", lat: 6.88, lon: 101.3 }),
    entry({
      code: "940201",
      nameTh: "เกาะเปาะ",
      nameEn: "Ko Po",
      districtCode: "9402",
      districtTh: "โคกโพธิ์",
      districtEn: "Khok Pho",
      lat: 6.7,
      lon: 101.1,
    }),
  ];

  it("names every tambon, and each district once, in Thai with its rank", () => {
    const labels = areaLabels(tambons, "th");
    expect(labels.filter((l) => l.kind === "tambon").map((l) => l.label)).toEqual([
      "ต.ตะลุโบะ",
      "ต.บานา",
      "ต.เกาะเปาะ",
    ]);
    expect(labels.filter((l) => l.kind === "district").map((l) => l.label)).toEqual([
      "อ.เมืองปัตตานี",
      "อ.โคกโพธิ์",
    ]);
  });

  it("writes the romanized names for the other two languages", () => {
    const labels = areaLabels(tambons, "en");
    expect(labels.map((l) => l.label)).toContain("Bana");
    expect(labels.map((l) => l.label)).toContain("Mueang Pattani");
  });

  it("puts a district's name in the middle of its tambons", () => {
    const mueang = areaLabels(tambons, "th").find((l) => l.code === "9401")!;
    expect(mueang.lat).toBeCloseTo(6.87, 5);
    expect(mueang.lon).toBeCloseTo(101.28, 5);
  });

  it("leaves out an area the database could not place, rather than drawing it at 0, 0", () => {
    const labels = areaLabels([...tambons, entry({ code: "950101", lat: 0, lon: 0 })], "th");
    expect(labels.some((l) => l.code === "950101")).toBe(false);
  });

  it("is GeoJSON points carrying the kind the two layers filter on", () => {
    const features = areaLabelFeatures(areaLabels(tambons, "th")).features;
    expect(features).toHaveLength(5);
    expect(features[0]!.geometry).toEqual({ type: "Point", coordinates: [101.26, 6.86] });
    expect(features[0]!.properties).toMatchObject({ kind: "tambon", code: "940111" });
  });
});

describe("when each kind of name appears", () => {
  it("districts with the rest of the detail, tambons a few steps further in", () => {
    const steps = labelSteps(7);
    expect(steps.district).toBe(7 + DETAIL_STEP);
    expect(steps.tambon).toBeGreaterThan(steps.district);
    // About one province filling the map, and well before someone's own place fills it.
    expect(steps.tambon).toBe(9.4);
  });

  it("our names queue before the basemap's, so a village name yields to a tambon name", () => {
    const layers = [
      { id: "water", type: "fill" },
      { id: "jaga-alert-fill", type: "fill" },
      { id: "place-village", type: "symbol" },
      { id: "place-town", type: "symbol" },
      { id: "jaga-mine-label", type: "symbol" },
    ];
    expect(beforeBasemapLabels(layers)).toBe("place-village");
    // A basemap with no names of its own (the satellite picture) puts ours on top.
    expect(beforeBasemapLabels([{ id: "jaga-base-satellite", type: "raster" }])).toBeUndefined();
  });
});
