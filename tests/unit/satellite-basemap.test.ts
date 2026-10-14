import type { Map as MapLibreMap, StyleSpecification } from "maplibre-gl";
import { describe, expect, it } from "vitest";
import {
  BASEMAPS,
  ESRI_FAILS_BEFORE_FALLBACK,
  esriImageryTiles,
  isPhotoBasemap,
  satelliteProvider,
  satelliteSource,
  setBasemap,
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

/** The style setBasemap would give MapLibre, for a basemap chosen on an empty map. */
function styleFor(basemap: (typeof BASEMAPS)[number]): StyleSpecification {
  let made: StyleSpecification | undefined;
  const map = {
    setStyle: (
      style: StyleSpecification | string,
      options: {
        transformStyle: (
          p: StyleSpecification | undefined,
          n: StyleSpecification,
        ) => StyleSpecification;
      },
    ) => {
      const next: StyleSpecification =
        typeof style === "string" ? { version: 8, sources: {}, layers: [] } : style;
      made = options.transformStyle(undefined, next);
    },
  } as unknown as MapLibreMap;
  setBasemap(map, basemap);
  return made!;
}

describe("satellite with the terrain shaded over it", () => {
  it("is a photograph basemap like the plain satellite one", () => {
    expect(BASEMAPS).toContain("satelliteTerrain");
    expect(isPhotoBasemap("satelliteTerrain")).toBe(true);
    expect(isPhotoBasemap("satellite")).toBe(true);
    expect(isPhotoBasemap("terrain")).toBe(false);
    expect(isPhotoBasemap("streets")).toBe(false);
  });

  it("lays see-through hill shading over the satellite picture", () => {
    const style = styleFor("satelliteTerrain");
    expect(style.layers.map((l) => l.id)).toEqual(["jaga-base-satellite", "jaga-base-hillshade"]);
    expect(style.sources["jaga-base-dem"]).toMatchObject({
      type: "raster-dem",
      encoding: "terrarium",
    });
    const shade = style.layers[1] as { paint: Record<string, unknown> };
    // Only light and shadow, never a solid colour that would hide the picture.
    for (const key of [
      "hillshade-shadow-color",
      "hillshade-highlight-color",
      "hillshade-accent-color",
    ]) {
      expect(String(shade.paint[key])).toMatch(/^rgba\(/);
    }
  });

  it("the plain satellite basemap has no shading", () => {
    const style = styleFor("satellite");
    expect(style.layers.map((l) => l.id)).toEqual(["jaga-base-satellite"]);
    expect(style.sources["jaga-base-dem"]).toBeUndefined();
  });
});
