import type { Map as MapLibreMap, StyleSpecification } from "maplibre-gl";
import { describe, expect, it } from "vitest";
import {
  BASEMAPS,
  ESRI_FAILS_BEFORE_FALLBACK,
  ESRI_SOURCE_PREFIX,
  esriImageryTiles,
  esriTerrainStyle,
  esriTerrainStyleUrl,
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

describe("the terrain background", () => {
  it("asks Esri for its terrain style in the page's language, with the key", () => {
    const url = esriTerrainStyleUrl("k+y/1", "th");
    expect(url).toContain("basemapstyles-api.arcgis.com");
    expect(url).toContain("/styles/arcgis/terrain?language=th&");
    expect(url).toContain("token=k%2By%2F1");
  });

  it("keeps Jaga's font server and renames Esri's sources so a basemap change drops them", () => {
    const raw = {
      version: 8,
      glyphs: "https://basemaps-api.arcgis.com/fonts/{fontstack}/{range}.pbf?token=x",
      sources: {
        esri: {
          type: "vector",
          url: "https://basemaps-api.arcgis.com/x",
          attribution: "Sources: Esri, TomTom",
        },
        abc123: {
          type: "raster",
          url: "https://ibasemaps-api.arcgis.com/h",
          attribution: "Esri hillshade",
        },
      },
      layers: [
        { id: "Land", type: "fill", source: "esri", "source-layer": "Land" },
        { id: "Hillshade", type: "raster", source: "abc123" },
        {
          id: "Road/label",
          type: "symbol",
          source: "esri",
          "source-layer": "Road",
          layout: { "text-font": ["Arial Bold"] },
        },
        {
          id: "Place/label",
          type: "symbol",
          source: "esri",
          "source-layer": "Place",
          layout: { "text-font": ["Arial Unicode MS Regular"] },
        },
        {
          id: "Water/label",
          type: "symbol",
          source: "esri",
          "source-layer": "Water",
          layout: { "text-font": ["Arial Italic"] },
        },
      ],
    } as unknown as StyleSpecification;
    const style = esriTerrainStyle(raw);
    expect(style.glyphs).toContain("tiles.openfreemap.org");
    expect(Object.keys(style.sources)).toEqual([ESRI_SOURCE_PREFIX, `${ESRI_SOURCE_PREFIX}-1`]);
    expect(style.layers.map((l) => ("source" in l ? l.source : null))).toEqual([
      ESRI_SOURCE_PREFIX,
      `${ESRI_SOURCE_PREFIX}-1`,
      ESRI_SOURCE_PREFIX,
      ESRI_SOURCE_PREFIX,
      ESRI_SOURCE_PREFIX,
    ]);
    const fonts = style.layers
      .filter((l) => l.type === "symbol")
      .map((l) => (l as { layout: Record<string, unknown> }).layout["text-font"]);
    expect(fonts).toEqual([["Noto Sans Bold"], ["Noto Sans Regular"], ["Noto Sans Italic"]]);
    // Esri's own credit, led once by the "Powered by Esri" Esri asks for.
    const credit = (id: string) => (style.sources[id] as { attribution?: string }).attribution;
    expect(credit(ESRI_SOURCE_PREFIX)).toMatch(/^Powered by .*Esri.*\| Sources: Esri, TomTom$/);
    expect(credit(`${ESRI_SOURCE_PREFIX}-1`)).toBe("Esri hillshade");
    // A source without a credit of its own gets Esri's full line.
    const bare = esriTerrainStyle({
      ...raw,
      sources: { esri: { type: "vector", url: "x" } },
    } as StyleSpecification);
    expect((bare.sources[ESRI_SOURCE_PREFIX] as { attribution?: string }).attribution).toMatch(
      /^Powered by .*Esri.*TomTom/,
    );
  });

  it("without a key it is the open street map with the hills shaded", () => {
    const style = styleFor("terrain");
    expect(style.layers.map((l) => l.id)).toEqual(["jaga-base-hillshade"]);
    expect(style.sources["jaga-base-dem"]).toMatchObject({ encoding: "terrarium" });
  });
});
