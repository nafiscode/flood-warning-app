import { describe, expect, it } from "vitest";
import type { AreaDirectory } from "@/lib/area";
import { lookupLocation, rowsFromDirectory } from "@/lib/location-lookup";

/*
 * The box for people who have not signed in (the owner, 23 Oct 2026). What it must get right:
 * coordinates are understood with no list and no network, a name finds Jaga's own tambons, and
 * nothing here ever asks a third party.
 */
const DIRECTORY: AreaDirectory = {
  provinces: [
    { code: "94", nameTh: "ปัตตานี", nameEn: "Pattani", status: "active" },
    { code: "95", nameTh: "ยะลา", nameEn: "Yala", status: "active" },
  ],
  tambons: [
    {
      code: "940104",
      nameTh: "บานา",
      nameEn: "Bana",
      districtCode: "9401",
      districtTh: "เมืองปัตตานี",
      districtEn: "Mueang Pattani",
      provinceCode: "94",
      lat: 6.878,
      lon: 101.272,
    },
    {
      code: "950101",
      nameTh: "สะเตง",
      nameEn: "Sateng",
      districtCode: "9501",
      districtTh: "เมืองยะลา",
      districtEn: "Mueang Yala",
      provinceCode: "95",
      lat: 6.54,
      lon: 101.28,
    },
  ],
};
const ROWS = rowsFromDirectory(DIRECTORY);

describe("rows from the directory", () => {
  it("name each tambon's district and province for the search", () => {
    expect(ROWS[0]).toMatchObject({
      code: "940104",
      provinceTh: "ปัตตานี",
      provinceEn: "Pattani",
      districtEn: "Mueang Pattani",
    });
  });
});

describe("pasted coordinates", () => {
  it.each([
    ["6.87821, 101.27191", 6.87821, 101.27191],
    ["6.87821,101.27191", 6.87821, 101.27191],
    ["๖.๘๗๘๒๑, ๑๐๑.๒๗๑๙๑", 6.87821, 101.27191],
    ["https://www.google.com/maps/@6.87821,101.27191,17z", 6.87821, 101.27191],
  ])("%s is a point, with or without the list", (text, lat, lon) => {
    for (const rows of [null, ROWS]) {
      const found = lookupLocation(text, rows, "th");
      expect(found.kind).toBe("point");
      if (found.kind === "point") {
        expect(found.point.lat).toBeCloseTo(lat, 5);
        expect(found.point.lon).toBeCloseTo(lon, 5);
      }
    }
  });

  it("a full Plus Code is a point near where it says", () => {
    const found = lookupLocation("6PH5WQ5C+PP", null, "th");
    expect(found.kind).toBe("point");
  });
});

describe("a name", () => {
  it("finds Jaga's own tambon, with its code, once the list is there", () => {
    const found = lookupLocation("บานา", ROWS, "th");
    expect(found.kind).toBe("places");
    if (found.kind === "places") {
      expect(found.places[0]).toMatchObject({ name: "ต.บานา", source: "tambon", code: "940104" });
    }
  });

  it("asks for the list when it has not arrived, rather than saying 'not found'", () => {
    expect(lookupLocation("บานา", null, "th")).toEqual({ kind: "needsDirectory" });
  });

  it("says nothing was found as an empty list, never as a made-up place", () => {
    expect(lookupLocation("กรุงเทพ", ROWS, "th")).toEqual({ kind: "places", places: [] });
  });
});

describe("links and codes that need more than the browser", () => {
  it("does not guess where a short map link leads", () => {
    expect(lookupLocation("https://maps.app.goo.gl/abc123", ROWS, "th")).toEqual({
      kind: "shortLink",
    });
  });

  it("does not read a position out of an address that is not a map", () => {
    expect(lookupLocation("https://example.com/page", ROWS, "th")).toEqual({
      kind: "unknownLink",
    });
  });

  it("completes a short Plus Code from the town it names", () => {
    const found = lookupLocation("V7HC+7Q Bana, Pattani", ROWS, "en");
    expect(found.kind).toBe("point");
  });

  it("leaves an empty box alone", () => {
    expect(lookupLocation("   ", ROWS, "th")).toEqual({ kind: "empty" });
  });
});
