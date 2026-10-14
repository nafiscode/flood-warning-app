import { describe, expect, it } from "vitest";
import {
  ESRI_FAILS_BEFORE_FALLBACK,
  esriImageryTiles,
  satelliteProvider,
  satelliteSource,
} from "@/lib/map";
import en from "@/messages/en.json";
import ms from "@/messages/ms.json";
import th from "@/messages/th.json";

describe("the satellite background", () => {
  it("is Esri World Imagery when Jaga has a key that still answers, else EOX", () => {
    expect(satelliteProvider("abc", false)).toBe("esri");
    expect(satelliteProvider("", false)).toBe("eox");
    // The month's free tiles used up, or the key refused: EOX for the rest of the visit.
    expect(satelliteProvider("abc", true)).toBe("eox");
    expect(ESRI_FAILS_BEFORE_FALLBACK).toBeGreaterThan(1);
  });

  it("asks Esri's basemap host with the key as a token, at 256 px tiles", () => {
    const source = satelliteSource("esri", "k+y/1");
    expect(source.tiles).toEqual([esriImageryTiles("k+y/1")]);
    expect(source.tiles[0]).toBe(
      "https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?token=k%2By%2F1",
    );
    expect(source.tileSize).toBe(256);
  });

  it("carries the credit each provider asks for", () => {
    expect(satelliteSource("esri", "k").attribution).toMatch(/^Powered by .*Esri.* \| Esri, Maxar/);
    expect(satelliteSource("eox").attribution).toContain("EOX");
    expect(satelliteSource("eox").tiles[0]).toContain("tiles.maps.eox.at");
  });

  it("says what each picture is, in all three languages", () => {
    for (const m of [th, ms, en]) {
      expect(m.map.basemap.satelliteNote).toBeTruthy();
      expect(m.map.basemap.satelliteNoteEsri).toBeTruthy();
    }
  });
});
