import type { Map as MapLibreMap, StyleSpecification } from "maplibre-gl";

/** The four covered provinces, with a little margin: [west, south, east, north]. */
export const SERVICE_BOUNDS: [number, number, number, number] = [99.95, 5.55, 102.25, 8.0];

/** OpenFreeMap: free, no API key (CLAUDE.md, Maps). Positron by day, its dark twin at night. */
const BASEMAP_STYLE = "https://tiles.openfreemap.org/styles/positron";
const BASEMAP_STYLE_DARK = "https://tiles.openfreemap.org/styles/dark";

/** True once the page has turned dark for the night (components/DaylightTheme.tsx). */
export function darkNow(): boolean {
  return typeof document !== "undefined" && document.documentElement.dataset.theme === "dark";
}

/**
 * The basemaps a person can choose (the owner, 12 Oct 2026). All free and without a key:
 *   streets    OpenFreeMap, light by day and dark at night; the default.
 *   terrain    by day, Esri's own terrain map (the owner, 15 Oct 2026): its vector map with names
 *              in the reader's language over its hill shading, with the ArcGIS key the satellite
 *              picture uses. Esri has no night version, so after dark, without a key, or once Esri
 *              stops answering, the street map with the hills shaded from open elevation tiles
 *              (Mapzen's Terrarium set on AWS), which follows day and night.
 *   satellite  Esri World Imagery when Jaga has an ArcGIS key (the owner, 14 Oct 2026): satellite
 *              and aerial pictures down to about half a metre in towns, so single houses show.
 *              Without a key, or once Esri stops answering (the free allowance is 2 million tiles
 *              a month; past it the tiles stop, since pay-as-you-go is left off), Sentinel-2
 *              cloudless by EOX: a cloud-free picture of 2020 at about 10 m. A photograph has no
 *              night version, so it always looks like day.
 *   satelliteTerrain  the same picture with the hills shaded over it from the same elevation tiles
 *              (the owner, 15 Oct 2026), so slopes and valleys read where the photograph alone looks
 *              flat. Light and shadow are see-through, so the picture stays a picture.
 */
export const BASEMAPS = ["streets", "terrain", "satellite", "satelliteTerrain"] as const;
export type Basemap = (typeof BASEMAPS)[number];
/** The basemaps that are a photograph: always day-like, and fed by the satellite source. */
export const isPhotoBasemap = (basemap: Basemap): boolean =>
  basemap === "satellite" || basemap === "satelliteTerrain";
const SATELLITE_TILES =
  "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg";
const SATELLITE_CREDIT =
  'Sentinel-2 cloudless 2020 by <a href="https://s2maps.eu" target="_blank" rel="noopener">EOX</a> (contains modified Copernicus Sentinel data), CC BY-NC-SA 4.0';

/*
 * Esri World Imagery through ArcGIS Location Platform. The key is a browser key by Esri's design:
 * it is visible in the page and is restricted to Jaga's own web addresses in Esri's dashboard, and
 * it may use the basemaps and nothing else. The credit line is the one Esri asks for.
 */
const ARCGIS_KEY = process.env.NEXT_PUBLIC_ARCGIS_API_KEY ?? "";
const ESRI_CREDIT =
  'Powered by <a href="https://www.esri.com" target="_blank" rel="noopener">Esri</a> | Esri, Maxar, Earthstar Geographics, and the GIS User Community';
export function esriImageryTiles(key: string): string {
  return `https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?token=${encodeURIComponent(key)}`;
}
/** Failed Esri tiles before the map gives up on Esri for this visit and shows EOX instead. */
export const ESRI_FAILS_BEFORE_FALLBACK = 4;
let esriFailed = false;
const satelliteListeners = new Set<() => void>();
/** For a screen that says which picture is shown: told once, when Esri gives way to EOX. */
export function subscribeSatellite(listener: () => void): () => void {
  satelliteListeners.add(listener);
  return () => {
    satelliteListeners.delete(listener);
  };
}
export type SatelliteProvider = "esri" | "eox";
/** Which picture the satellite basemap shows: Esri with a key that still answers, else EOX. */
export function satelliteProvider(
  key: string = ARCGIS_KEY,
  failed = esriFailed,
): SatelliteProvider {
  return key && !failed ? "esri" : "eox";
}
/** The raster source for the satellite basemap. */
export function satelliteSource(provider: SatelliteProvider, key: string = ARCGIS_KEY) {
  return provider === "esri"
    ? {
        type: "raster" as const,
        tiles: [esriImageryTiles(key)],
        tileSize: 256,
        maxzoom: 19,
        attribution: ESRI_CREDIT,
      }
    : {
        type: "raster" as const,
        tiles: [SATELLITE_TILES],
        tileSize: 256,
        maxzoom: 15,
        attribution: SATELLITE_CREDIT,
      };
}
/*
 * Esri's terrain map, from the ArcGIS Basemap Styles service (the same key and the same free
 * allowance as the satellite picture). Its labels ask for Arial fonts from Esri's own font server,
 * which has none of the font Jaga's own labels use, so the map keeps OpenFreeMap's fonts and the
 * Esri labels are drawn in the Noto Sans of matching weight (it covers Thai and Malay).
 */
export function esriTerrainStyleUrl(key: string, language: string): string {
  return `https://basemapstyles-api.arcgis.com/arcgis/rest/services/styles/v2/styles/arcgis/terrain?language=${encodeURIComponent(language)}&token=${encodeURIComponent(key)}`;
}
const POWERED_BY_ESRI =
  'Powered by <a href="https://www.esri.com" target="_blank" rel="noopener">Esri</a>';
const ESRI_TERRAIN_CREDIT = `${POWERED_BY_ESRI} | Esri, TomTom, Garmin, FAO, NOAA, USGS, © OpenStreetMap contributors, and the GIS User Community`;
/** Esri's own source ids are renamed under jaga-base-esri, so a basemap change drops them. */
export const ESRI_SOURCE_PREFIX = "jaga-base-esri";
const GLYPHS = "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf";
const notoFor = (font: string) =>
  /bold/i.test(font)
    ? "Noto Sans Bold"
    : /italic/i.test(font)
      ? "Noto Sans Italic"
      : "Noto Sans Regular";

/** Esri's terrain style made fit to sit under Jaga's layers: our font server, our source names. */
export function esriTerrainStyle(raw: StyleSpecification): StyleSpecification {
  const names = new Map(
    Object.keys(raw.sources).map((id, i) => [
      id,
      i === 0 ? ESRI_SOURCE_PREFIX : `${ESRI_SOURCE_PREFIX}-${i}`,
    ]),
  );
  // Esri's own credit where it gives one, led by the "Powered by Esri" Esri asks for, once.
  const sources = Object.fromEntries(
    Object.entries(raw.sources).map(([id, source], i) => {
      const own = (source as { attribution?: string }).attribution;
      const attribution = !own
        ? ESRI_TERRAIN_CREDIT
        : i === 0 && !/powered by/i.test(own)
          ? `${POWERED_BY_ESRI} | ${own}`
          : own;
      return [names.get(id)!, { ...source, attribution }];
    }),
  ) as StyleSpecification["sources"];
  const layers = raw.layers.map((layer) => {
    const named =
      "source" in layer && typeof layer.source === "string" && names.has(layer.source)
        ? { ...layer, source: names.get(layer.source)! }
        : layer;
    if (named.type !== "symbol") return named;
    const font = named.layout?.["text-font"];
    if (!Array.isArray(font) || !font.every((f) => typeof f === "string")) return named;
    return {
      ...named,
      layout: { ...named.layout, "text-font": [notoFor((font as string[])[0] ?? "")] },
    };
  }) as StyleSpecification["layers"];
  return { ...raw, glyphs: GLYPHS, sources, layers };
}

/** Esri's terrain style for one language, fetched once a visit; null when Esri will not give it. */
const esriTerrainCache = new Map<string, Promise<StyleSpecification | null>>();
function fetchEsriTerrain(language: string): Promise<StyleSpecification | null> {
  let ask = esriTerrainCache.get(language);
  if (!ask) {
    ask = fetch(esriTerrainStyleUrl(ARCGIS_KEY, language))
      .then((r) => (r.ok ? (r.json() as Promise<StyleSpecification>) : null))
      .then((raw) => (raw && Array.isArray(raw.layers) ? esriTerrainStyle(raw) : null))
      .catch(() => null);
    esriTerrainCache.set(language, ask);
  }
  return ask;
}
/** The page's language, which Esri's names follow. */
const esriLanguage = () => {
  const lang = typeof document === "undefined" ? "th" : document.documentElement.lang || "th";
  return ["th", "ms", "en"].includes(lang) ? lang : "th";
};

const TERRAIN_TILES = "https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png";
const TERRAIN_CREDIT = "Elevation: Mapzen terrain tiles on AWS (SRTM, GMTED and others)";

let chosen: Basemap = "streets";
/** Whether the map itself is dark right now: at night, except on the satellite picture. */
export const mapIsDark = () => darkNow() && !isPhotoBasemap(chosen);

/**
 * The colours our own layers draw with. On a dark map the outlines and dots turn light, or they
 * would disappear into it; the alert colours of the tambons never change.
 */
export const mapInk = () => (mapIsDark() ? "#cfe0e8" : "#1d3b53");
export const mapHalo = () => (mapIsDark() ? "#0f1c26" : "#ffffff");

export const TAMBON_SOURCE = "jaga-tambons";
export const TAMBONS_URL = "/api/geo/tambons";
const BOUNDARY_CREDIT = "Boundaries: Royal Thai Survey Department via OCHA (CC BY-IGO)";

// Brand colors (docs/brand.md). Map layers can't read CSS variables.
const SLATE = "#1d3b53";
const TEAL = "#2f9c95";
const GROUND = "#f0f2ee";
const GROUND_DARK = "#0f1c26";

/**
 * The tambon outlines. On a street map, slate (pale at night) and quiet. On a photograph the slate
 * vanished into dark fields and forest (the owner, 15 Oct 2026: a little more visible, not too
 * much), so there they are pale, a touch wider and half see-through.
 */
export function tambonLinePaint(dark: boolean, photo: boolean) {
  return photo
    ? { "line-color": "#f2f5f3", "line-width": 0.9, "line-opacity": 0.4 }
    : {
        "line-color": dark ? "#cfe0e8" : SLATE,
        "line-width": 0.8,
        "line-opacity": dark ? 0.5 : 0.6,
      };
}

const startStyle = (dark: boolean): StyleSpecification => ({
  version: 8,
  // The same free font server the basemap uses, so our own labels can be drawn before (and
  // without) the basemap. No key, same host as the tiles.
  glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
  sources: {
    [TAMBON_SOURCE]: { type: "geojson", data: TAMBONS_URL, attribution: BOUNDARY_CREDIT },
  },
  layers: [
    {
      id: "jaga-ground",
      type: "background",
      paint: { "background-color": dark ? GROUND_DARK : GROUND },
    },
    {
      id: "jaga-tambon-fill",
      type: "fill",
      source: TAMBON_SOURCE,
      paint: { "fill-color": TEAL, "fill-opacity": 0.01 },
    },
    {
      id: "jaga-tambon-selected",
      type: "fill",
      source: TAMBON_SOURCE,
      filter: ["in", ["get", "code"], ["literal", []]],
      paint: { "fill-color": TEAL, "fill-opacity": 0.45 },
    },
    {
      id: "jaga-tambon-line",
      type: "line",
      source: TAMBON_SOURCE,
      paint: tambonLinePaint(dark, isPhotoBasemap(chosen)),
    },
  ],
});

/** Roughly each covered province, for the map's province selector: [west, south, east, north]. */
export const PROVINCE_BOUNDS: Record<string, [number, number, number, number]> = {
  "90": [100.05, 6.29, 101.11, 7.94],
  "94": [101.02, 6.55, 101.72, 6.95],
  "95": [100.83, 5.61, 101.61, 6.68],
  "96": [101.37, 5.73, 102.09, 6.64],
};

/**
 * The whole provinces of the person's own places, as one box (the owner, 15 Oct 2026: someone in
 * Pattani who watches a place in Narathiwat sees both provinces in full when the map opens). Takes
 * tambon (or any DOPA) codes; codes outside the four provinces are left out. Undefined when none
 * is left, so the map shows all four.
 */
export function provincesBox(
  codes: readonly (string | null | undefined)[],
): [number, number, number, number] | undefined {
  const boxes = [...new Set(codes.map((code) => code?.slice(0, 2) ?? ""))]
    .map((province) => PROVINCE_BOUNDS[province])
    .filter((box): box is [number, number, number, number] => box !== undefined);
  if (boxes.length === 0) return undefined;
  return [
    Math.min(...boxes.map((b) => b[0])),
    Math.min(...boxes.map((b) => b[1])),
    Math.max(...boxes.map((b) => b[2])),
    Math.max(...boxes.map((b) => b[3])),
  ];
}

export const TAMBON_FILL_LAYER = "jaga-tambon-fill";
export const TAMBON_LINE_LAYER = "jaga-tambon-line";
export const TAMBON_SELECTED_LAYER = "jaga-tambon-selected";

/**
 * A map of the service area. It starts with only Jaga's own tambon outlines, so it is usable at
 * once and still works when the basemap can't be reached; the street basemap is then loaded
 * underneath. MapLibre itself is loaded here, on demand, never with the page (slow 3G).
 */
/** Parts of a basemap that are ours to add and must not be carried from one basemap to the next. */
const BASE_PARTS = ["jaga-ground", "jaga-base-satellite", "jaga-base-hillshade"];
const BASE_SOURCES = ["jaga-base-satellite", "jaga-base-dem"];
const isBaseSource = (id: string) => BASE_SOURCES.includes(id) || id.startsWith(ESRI_SOURCE_PREFIX);

/** The satellite picture as a whole style: one raster layer, and the font server our labels need. */
const satelliteStyle = (): StyleSpecification => ({
  version: 8,
  glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
  sources: {
    "jaga-base-satellite": satelliteSource(satelliteProvider()),
  },
  layers: [{ id: "jaga-base-satellite", type: "raster", source: "jaga-base-satellite" }],
});

/** Hill shading from the open elevation tiles, tuned for the ground it lies on. */
function withHillshade(
  style: StyleSpecification,
  look: "map" | "mapDark" | "photo",
): StyleSpecification {
  const paint =
    look === "photo"
      ? {
          // Over a photograph: see-through light and shadow only, a little stronger than on the
          // street map because the picture's own colours hide gentle slopes.
          "hillshade-exaggeration": 0.7,
          "hillshade-shadow-color": "rgba(0, 0, 0, 0.55)",
          "hillshade-highlight-color": "rgba(255, 255, 255, 0.22)",
          "hillshade-accent-color": "rgba(0, 0, 0, 0.25)",
        }
      : {
          "hillshade-exaggeration": 0.55,
          "hillshade-shadow-color": look === "mapDark" ? "#000000" : "#3b4a57",
          "hillshade-highlight-color": look === "mapDark" ? "#5d7382" : "#ffffff",
          "hillshade-accent-color": look === "mapDark" ? "#0b1117" : "#6b7780",
        };
  return {
    ...style,
    sources: {
      ...style.sources,
      "jaga-base-dem": {
        type: "raster-dem",
        tiles: [TERRAIN_TILES],
        tileSize: 256,
        maxzoom: 13,
        encoding: "terrarium",
        attribution: TERRAIN_CREDIT,
      },
    },
    layers: [
      ...style.layers,
      { id: "jaga-base-hillshade", type: "hillshade", source: "jaga-base-dem", paint },
    ],
  };
}

/**
 * Put another basemap under our own layers. Everything of ours (sources with the data they hold,
 * and the layers in their order) is carried across; only the basemap's own parts are replaced.
 * The caller draws again on "styledata", which also recolours our outlines for the new ground.
 */
export function setBasemap(map: MapLibreMap, basemap: Basemap): void {
  chosen = basemap;
  const dark = mapIsDark();
  if (basemap === "terrain" && !dark && satelliteProvider() === "esri") {
    // Esri's terrain by day. Until its style arrives the map keeps what it shows; if Esri will
    // not give it, the open terrain instead, for the rest of the visit.
    void fetchEsriTerrain(esriLanguage()).then((style) => {
      if (chosen !== "terrain") return;
      if (style) {
        map.setStyle(style, { transformStyle: (previous, next) => carryOwn(previous, next) });
        return;
      }
      giveUpOnEsri();
      setBasemap(map, "terrain");
    });
    return;
  }
  const photo = isPhotoBasemap(basemap);
  const style = photo ? satelliteStyle() : dark ? BASEMAP_STYLE_DARK : BASEMAP_STYLE;
  map.setStyle(style, {
    transformStyle: (previous, next) =>
      carryOwn(
        previous,
        basemap === "terrain"
          ? withHillshade(next, dark ? "mapDark" : "map")
          : basemap === "satelliteTerrain"
            ? withHillshade(next, "photo")
            : next,
      ),
  });
}

/** Everything of ours (sources with the data they hold, layers in their order) on a new base. */
function carryOwn(
  previous: StyleSpecification | undefined,
  base: StyleSpecification,
): StyleSpecification {
  if (!previous) return base;
  const own = previous.layers
    .filter((l) => l.id.startsWith("jaga-") && !BASE_PARTS.includes(l.id))
    // The tambon outlines take the colour that reads on the new ground.
    .map((l) =>
      l.id === TAMBON_LINE_LAYER && l.type === "line"
        ? { ...l, paint: { ...l.paint, ...tambonLinePaint(mapIsDark(), isPhotoBasemap(chosen)) } }
        : l,
    );
  // Every source of ours comes along, with whatever data it holds by now.
  const ownSources = Object.fromEntries(
    Object.entries(previous.sources).filter(([id]) => id.startsWith("jaga-") && !isBaseSource(id)),
  );
  return {
    ...base,
    sources: { ...base.sources, ...ownSources },
    layers: [...base.layers, ...own],
  };
}

/** Esri stopped answering: EOX and the open terrain for the rest of the visit. */
function giveUpOnEsri(): void {
  if (esriFailed) return;
  esriFailed = true;
  for (const listener of satelliteListeners) listener();
}

let pmtilesReady = false;
/**
 * Teach MapLibre the `pmtiles://` address once: a PMTiles file is one static file on the tile
 * bucket, read in ranges, so the hazard layer needs no tile server (CLAUDE.md, Stack). A failure
 * here must not cost the map itself, so it is swallowed: the layer then stays "being prepared".
 */
async function registerPmtiles(maplibre: typeof import("maplibre-gl")): Promise<void> {
  if (pmtilesReady) return;
  try {
    const { Protocol } = await import("pmtiles");
    maplibre.addProtocol("pmtiles", new Protocol().tile);
    pmtilesReady = true;
  } catch {
    // No hazard layer this time; everything else draws as before.
  }
}

export async function createServiceAreaMap(
  container: HTMLElement,
  basemap: Basemap = "streets",
): Promise<MapLibreMap> {
  chosen = basemap;
  const maplibre = await import("maplibre-gl");
  // The worker is served from public/vendor (scripts/vendor-maplibre.mjs), not from the bundle.
  maplibre.setWorkerUrl(`/vendor/maplibre/${maplibre.getVersion()}/maplibre-gl-worker.mjs`);
  await registerPmtiles(maplibre);
  const map = new maplibre.Map({
    container,
    style: startStyle(mapIsDark()),
    bounds: SERVICE_BOUNDS,
    fitBoundsOptions: { padding: 8 },
    maxBounds: [
      [SERVICE_BOUNDS[0] - 1.5, SERVICE_BOUNDS[1] - 1.5],
      [SERVICE_BOUNDS[2] + 1.5, SERVICE_BOUNDS[3] + 1.5],
    ],
    dragRotate: false,
    pitchWithRotate: false,
    attributionControl: { compact: true },
  });
  map.touchZoomRotate.disableRotation();
  /*
   * When Esri stops answering (the month's free tiles used up, or the key refused), the
   * satellite view falls back to EOX for the rest of the visit rather than going blank.
   */
  let esriErrors = 0;
  map.on("error", (event) => {
    const source = (event as { sourceId?: string }).sourceId ?? "";
    const esri = source === "jaga-base-satellite" || source.startsWith(ESRI_SOURCE_PREFIX);
    if (!esri || satelliteProvider() !== "esri") return;
    esriErrors += 1;
    if (esriErrors < ESRI_FAILS_BEFORE_FALLBACK) return;
    giveUpOnEsri();
    if (isPhotoBasemap(chosen) || chosen === "terrain") setBasemap(map, chosen);
  });
  map.addControl(new maplibre.NavigationControl({ showCompass: false }), "top-right");

  map.once("load", () => {
    // The credits start folded behind their (i) button: opened, they cover a third of a phone map.
    const credits = container.querySelector(".maplibregl-ctrl-attrib");
    credits?.classList.remove("maplibregl-compact-show");
    credits?.removeAttribute("open");
    // Put the basemap under our layers, keeping whatever is selected at that moment.
    setBasemap(map, chosen);
  });
  // A failed basemap or tile must not break the picker: the outlines are enough to choose on.
  map.on("error", () => {});
  return map;
}

/**
 * A box that holds every one of these points, for the map to fly to (the owner's request of
 * 12 Oct: opening the dam's figures should also show the dam **and** the places the person has
 * saved, so the distance between them is something they can see).
 *
 * The box never gets smaller than MIN_SPAN, or a lone point - a dam with nobody's places beside
 * it - would zoom to the street and tell the reader nothing about where it sits.
 */
export const MIN_SPAN = { lon: 0.24, lat: 0.2 };
/** Breathing room on each side of the box, as a share of its own span. */
export const MARGIN = 0.06;

export function boundsAround(
  points: readonly { lon: number; lat: number }[],
): [number, number, number, number] | undefined {
  const usable = points.filter(
    (p) => Number.isFinite(p.lon) && Number.isFinite(p.lat) && (p.lon !== 0 || p.lat !== 0),
  );
  if (usable.length === 0) return undefined;
  const lons = usable.map((p) => p.lon);
  const lats = usable.map((p) => p.lat);
  const west = Math.min(...lons);
  const east = Math.max(...lons);
  const south = Math.min(...lats);
  const north = Math.max(...lats);
  // Grow around the middle until the box is at least MIN_SPAN across, so one point still gets
  // a neighbourhood around it rather than a rooftop.
  const growLon = Math.max(0, MIN_SPAN.lon - (east - west)) / 2;
  const growLat = Math.max(0, MIN_SPAN.lat - (north - south)) / 2;
  const [w, s, e, n] = [west - growLon, south - growLat, east + growLon, north + growLat];
  // A margin, so a pin on the edge of the box is not drawn half under the edge of the screen.
  const margin = { lon: (e - w) * MARGIN, lat: (n - s) * MARGIN };
  return [w - margin.lon, s - margin.lat, e + margin.lon, n + margin.lat];
}

/**
 * The basemap's own names (villages, towns, roads) that sit under one of our fills, in the order
 * they are drawn. Our layers are added after the basemap's, so the flood-risk shading, the alert
 * colours and the hill shading all land on top of its names and dim them; at night, over the risk
 * shading, they could not be read at all (owner, 13 Oct). The answer is the names to lift so they
 * end up directly under `anchor`, the first of our layers that is a line or a mark; empty when
 * they are already there, so asking again after the move changes nothing.
 */
export function labelsToLift(layers: { id: string; type: string }[], anchor: string): string[] {
  const at = layers.findIndex((l) => l.id === anchor);
  if (at < 0) return [];
  const labels = layers.filter((l) => l.type === "symbol" && !l.id.startsWith("jaga-"));
  const inPlace = layers.slice(Math.max(0, at - labels.length), at);
  return labels.length > 0 && labels.every((l, i) => inPlace[i]?.id === l.id)
    ? []
    : labels.map((l) => l.id);
}

/**
 * Lift the basemap's names above our fills (see `labelsToLift`), and on a dark map give them the
 * light ink and dark outline our own names use: the dark basemap writes its names in a dim grey
 * that is lost on the risk shading even when nothing covers it.
 */
export function liftBasemapLabels(map: MapLibreMap): void {
  const layers = map.getStyle().layers;
  for (const id of labelsToLift(layers, TAMBON_LINE_LAYER)) map.moveLayer(id, TAMBON_LINE_LAYER);
  if (!mapIsDark()) return;
  for (const layer of layers) {
    if (layer.type !== "symbol" || layer.id.startsWith("jaga-")) continue;
    if (map.getPaintProperty(layer.id, "text-color") === mapInk()) continue;
    map.setPaintProperty(layer.id, "text-color", mapInk());
    map.setPaintProperty(layer.id, "text-halo-color", mapHalo());
    map.setPaintProperty(layer.id, "text-halo-width", 1.4);
  }
}
