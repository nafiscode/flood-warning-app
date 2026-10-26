import type { Map as MapLibreMap, StyleSpecification } from "maplibre-gl";

/** The four covered provinces, with a little margin: [west, south, east, north]. */
export const SERVICE_BOUNDS: [number, number, number, number] = [99.95, 5.55, 102.25, 8.0];

/** OpenFreeMap: free, no API key (CLAUDE.md, Maps). Positron by day, its dark twin at night. */
const BASEMAP_STYLE = "https://tiles.openfreemap.org/styles/positron";
const BASEMAP_STYLE_DARK = "https://tiles.openfreemap.org/styles/dark";

/**
 * True while the sun is down at the person's own place (lib/sun.ts, written onto the page by
 * lib/theme-script.ts and kept there by components/DaylightTheme.tsx).
 *
 * This is the sun, not the theme. The two were the same thing until 20 Oct 2026, when the owner
 * asked that the background follow the time of day alone: somebody who picks the dark theme at
 * noon gets a dark app over the daylight picture of their district, and the map turns to the
 * night terrain at sunset and back at sunrise whatever they picked. Our own layers' colours
 * follow this too, because what they have to be legible against is the background.
 *
 * `data-theme` is the fallback for a page that has not written the daylight in yet, which is
 * what every build before this one went by.
 */
export function nightNow(): boolean {
  if (typeof document === "undefined") return false;
  const daylight = document.documentElement.dataset.daylight;
  if (daylight === "night") return true;
  if (daylight === "day") return false;
  return document.documentElement.dataset.theme === "dark";
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
export const mapIsDark = () => nightNow() && !isPhotoBasemap(chosen);
/** Whether the background is a photograph right now (satellite, or satellite with terrain). */
export const photoNow = () => isPhotoBasemap(chosen);

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
export const TEAL = "#2f9c95";
const GROUND = "#f0f2ee";
const GROUND_DARK = "#0f1c26";

/*
 * The coverage (responsibility) layer on the main map (spec 2, 9) draws exactly as the authority
 * console's own map does (components/authority/BoardMap.tsx): a covered tambon is teal, a gap -
 * no rescue team - is the map ink, and the viewer's own tambons get a teal outline. A missing
 * team is not an alert level, so no alert colour is ever used for it (brand.md). Shown only to
 * verified authorities and admins (safety rule 5).
 */
export const COVERAGE_FILL_LAYER = "jaga-coverage-fill";
export const COVERAGE_MINE_LAYER = "jaga-coverage-mine";
export const COVERAGE_COVERED_OPACITY = 0.55;
/** Only the tambons with a registered team are highlighted; a gap is left plain, not filled. */
export const COVERAGE_GAP_OPACITY = 0;
/** Violet: easy to spot on the map and not one of the alert or brand status colours. */
export const COVERAGE_COLOR = "#8e2de2";

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
const BASE_SOURCES = ["jaga-base-satellite", "jaga-base-dem", "jaga-base-scene"];
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
        map.setStyle(style, {
          transformStyle: (previous, next) => withScene(carryOwn(previous, next)),
        });
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
      withScene(
        carryOwn(
          previous,
          basemap === "terrain"
            ? withHillshade(next, dark ? "mapDark" : "map")
            : basemap === "satelliteTerrain"
              ? withHillshade(next, "photo")
              : next,
        ),
      ),
  });
}

/*
 * The 3D scene (the owner, 15 Oct 2026: "like a scene in ArcGIS Pro", with a 2D / 3D button on
 * the map). The ground is raised from the same free elevation tiles the hill shading uses, under
 * whichever background is chosen, and the map tilts. Heights are drawn SCENE_EXAGGERATION times
 * their real size, or the coastal plain, where the floods are, would look flat; the page says so.
 * It is never the default: a tilted map with raised ground costs a cheap phone far more.
 */
export const SCENE_SOURCE = "jaga-base-scene";
export const SCENE_EXAGGERATION = 1.5;
export const SCENE_PITCH = 60;
const SCENE_MAX_PITCH = 70;
let scene = false;
/** Whether the map is in 3D right now. */
export const inScene = () => scene;
const sceneSource = () => ({
  type: "raster-dem" as const,
  tiles: [TERRAIN_TILES],
  tileSize: 256,
  maxzoom: 13,
  encoding: "terrarium" as const,
  attribution: TERRAIN_CREDIT,
});
/** A sky behind the tilted map: daylight, or the night's blue over the dark map. */
export function sceneSky(dark: boolean) {
  return dark
    ? {
        "sky-color": "#0b1620",
        "horizon-color": "#1d3b53",
        "fog-color": "#0f1c26",
        "sky-horizon-blend": 0.6,
        "horizon-fog-blend": 0.6,
        "fog-ground-blend": 0.85,
        "atmosphere-blend": 0.6,
      }
    : {
        "sky-color": "#79acd6",
        "horizon-color": "#dde9f0",
        "fog-color": "#e8eef1",
        "sky-horizon-blend": 0.6,
        "horizon-fog-blend": 0.6,
        "fog-ground-blend": 0.85,
        "atmosphere-blend": 0.8,
      };
}
/** The style with the raised ground and the sky added, while the map is in 3D. */
export function withScene(style: StyleSpecification, on: boolean = scene): StyleSpecification {
  if (!on) return style;
  return {
    ...style,
    sources: { ...style.sources, [SCENE_SOURCE]: sceneSource() },
    terrain: { source: SCENE_SOURCE, exaggeration: SCENE_EXAGGERATION },
    sky: sceneSky(mapIsDark()),
  };
}
const motionOk = () =>
  typeof window === "undefined" || !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * Into 3D or back to 2D. In 3D the map may be tilted and turned (two fingers on a phone, the right
 * mouse button on a computer); back in 2D it lies flat again, north up, as it always was.
 */
export function setScene(map: MapLibreMap, on: boolean): void {
  scene = on;
  const duration = motionOk() ? 1200 : 0;
  if (on) {
    if (!map.getSource(SCENE_SOURCE)) map.addSource(SCENE_SOURCE, sceneSource());
    map.setTerrain({ source: SCENE_SOURCE, exaggeration: SCENE_EXAGGERATION });
    map.setSky(sceneSky(mapIsDark()));
    map.setMaxPitch(SCENE_MAX_PITCH);
    map.dragRotate.enable();
    map.touchZoomRotate.enableRotation();
    map.touchPitch.enable();
    map.easeTo({ pitch: SCENE_PITCH, duration });
    return;
  }
  map.setTerrain(null);
  map.dragRotate.disable();
  map.touchZoomRotate.disableRotation();
  map.touchPitch.disable();
  map.easeTo({ pitch: 0, bearing: 0, duration });
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

/**
 * What the map says when it holds a gesture back, in the reader's own language. MapLibre reads
 * these once, when the map is made, so they are given even on screens where the handler will
 * never be switched on.
 */
export type GestureText = { twoFingers: string; zoomCtrl: string; zoomCmd: string };

export async function createServiceAreaMap(
  container: HTMLElement,
  basemap: Basemap = "streets",
  gestures?: GestureText,
): Promise<MapLibreMap> {
  chosen = basemap;
  scene = false;
  const maplibre = await import("maplibre-gl");
  // The worker is served from public/vendor (scripts/vendor-maplibre.mjs), not from the bundle.
  maplibre.setWorkerUrl(`/vendor/maplibre/${maplibre.getVersion()}/maplibre-gl-worker.mjs`);
  await registerPmtiles(maplibre);
  // The opening flight starts from a hidden map, so the real extent never shows first.
  if (introWanted()) {
    container.setAttribute("data-map-intro", "wait");
    window.setTimeout(() => {
      if (container.getAttribute("data-map-intro") === "wait")
        container.removeAttribute("data-map-intro");
    }, 12000);
  }
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
    /*
     * One finger scrolls the page, two fingers move the map (the owner, 20 Oct: scrolling past
     * the map on a phone "just move the map instead of scrolling pass it"). The handler is
     * created here and switched on only where the map sits inside a scrolling page - MapView
     * does that - because what it really does is hand the browser back `touch-action: pan-x
     * pan-y`, and a map that fills the screen wants every gesture for itself.
     */
    cooperativeGestures: true,
    locale: gestures
      ? {
          "CooperativeGesturesHandler.MobileHelpText": gestures.twoFingers,
          "CooperativeGesturesHandler.WindowsHelpText": gestures.zoomCtrl,
          "CooperativeGesturesHandler.MacHelpText": gestures.zoomCmd,
        }
      : undefined,
  });
  // Off until something asks for it: the console's map and the full-screen map take one finger.
  map.cooperativeGestures.disable();
  map.touchZoomRotate.disableRotation();
  // Flat in 2D: a two-finger drag would otherwise tilt it (setScene turns this on in 3D).
  map.touchPitch.disable();
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
 * The opening shot (the owner, 25 Oct 2026): the map starts as the whole Earth seen from space
 * and glides down to the four provinces. By day the globe is NASA's Blue Marble picture of the
 * Earth, seamless, in a halo of atmosphere; after dark it is the Earth at night, city lights on black (NASA
 * GIBS, free, no key; the same day/night as the rest of the map, nightNow). The picture fades out
 * as the flight nears the provinces, leaving Jaga's ordinary map. It is only decoration and never
 * stands in anyone's way: the map answers touch from the first frame, the first touch, scroll or
 * key stops the flight where it is, and it is skipped when the visitor asks for less motion or has
 * Data Saver on. Once per browser tab, so a second visit to the map is not slowed down by it.
 */
const INTRO_KEY = "jaga.map.intro";
const INTRO_MS = 7000;
const INTRO_SOURCE = "jaga-intro-earth";
const INTRO_LAYER = "jaga-intro-earth";
const GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best";
/*
 * A single crisp, cloud-free picture of the service area and its surroundings, prepared once and
 * served from the app (public/intro/region.jpg, EOX Sentinel-2 cloudless, the same free mosaic the
 * satellite basemap can fall back to). The global imagery is coarse, so without this the descent
 * blurred as it closed in before the real tiles had loaded (the owner, 27 Oct 2026). It fades in as
 * the flight nears the provinces and hands over to the live map at the end. Its corners are the
 * lon/lat box it was cut to, clockwise from the top-left.
 */
const INTRO_REGION_SOURCE = "jaga-intro-region";
const INTRO_REGION_LAYER = "jaga-intro-region";
const introRegionUrl = (night: boolean) =>
  night ? "/intro/region-night.webp" : "/intro/region.webp";
const INTRO_REGION_BOX: [[number, number], [number, number], [number, number], [number, number]] = [
  [98, 10],
  [104.5, 10],
  [104.5, 4],
  [98, 4],
];

/** Few, coarse tiles: the descent never waits on the network, and the picture is gone before it blurs. */
function introTiles(night: boolean): { tiles: string[]; maxzoom: number; attribution: string } {
  if (night) {
    return {
      tiles: [
        `${GIBS}/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png`,
      ],
      maxzoom: 5,
      attribution: "Night lights: NASA Earth Observatory / NOAA / GIBS",
    };
  }
  // Blue Marble: one seamless picture of the whole Earth, no scan strips or gaps.
  return {
    tiles: [
      `${GIBS}/BlueMarble_NextGeneration/default/2004-08-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg`,
    ],
    maxzoom: 5,
    attribution: "Earth: NASA Earth Observatory / Blue Marble / GIBS",
  };
}

/** Whether this visit gets the opening flight: not with reduced motion or Data Saver, once a tab. */
export function introWanted(): boolean {
  try {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return false;
    const link = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    if (link?.saveData) return false;
    return !sessionStorage.getItem(INTRO_KEY);
  } catch {
    return false;
  }
}

export function playIntro(map: MapLibreMap): void {
  const container = map.getContainer();
  if (!introWanted()) {
    container.removeAttribute("data-map-intro");
    return;
  }
  const target = map.cameraForBounds(
    [
      [SERVICE_BOUNDS[0], SERVICE_BOUNDS[1]],
      [SERVICE_BOUNDS[2], SERVICE_BOUNDS[3]],
    ],
    { padding: 8 },
  );
  if (!target?.center || typeof target.zoom !== "number") {
    container.removeAttribute("data-map-intro");
    return;
  }
  const center = target.center as { lng: number; lat: number };
  const goal = target.zoom;
  const sky = map.getSky?.();
  const maxBounds = map.getMaxBounds();
  const minZoom = map.getMinZoom();

  // The Earth picture goes over everything, solid while far away and gone before the end. A
  // style swap (the basemap settling in just after the map loads) wipes it, so it is put back.
  const night = nightNow();
  /*
   * While the Earth is a globe, the basemap's own layers are switched off: wrapped round a sphere
   * they look like a candy wrapper. They come back under the Earth picture, which is still solid,
   * a little before it fades into the flat map.
   */
  const hidden = new Set<string>();
  let revealed = false;
  const hideBasemap = () => {
    if (revealed) return;
    for (const layer of map.getStyle()?.layers ?? []) {
      if (
        layer.id === INTRO_LAYER ||
        layer.id === INTRO_REGION_LAYER ||
        map.getLayoutProperty(layer.id, "visibility") === "none"
      )
        continue;
      map.setLayoutProperty(layer.id, "visibility", "none");
      hidden.add(layer.id);
    }
  };
  const reveal = () => {
    if (revealed) return;
    revealed = true;
    for (const id of hidden)
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "visible");
    hidden.clear();
  };
  // Hold the basemap back until the globe has flattened into the ordinary map, so it is never seen
  // wrapped round a sphere. By then the Earth picture, still solid, covers it; the picture then fades.
  const revealAt = () => {
    if (map.getZoom() >= goal - 0.8) reveal();
  };
  const dress = () => {
    try {
      if (!map.getSource(INTRO_SOURCE)) {
        // Clamp to Web Mercator's own range: nothing is drawn past ~85 degrees, so the imagery is
        // never stretched up to the poles (it was pulled into points there - "a lemon" - the owner).
        map.addSource(INTRO_SOURCE, {
          type: "raster",
          tileSize: 256,
          bounds: [-180, -85.0511, 180, 85.0511],
          ...introTiles(night),
        });
      }
      if (!map.getLayer(INTRO_LAYER)) {
        map.addLayer({
          id: INTRO_LAYER,
          type: "raster",
          source: INTRO_SOURCE,
          paint: {
            "raster-fade-duration": 300,
            "raster-opacity": ["interpolate", ["linear"], ["zoom"], goal - 0.7, 1, goal - 0.15, 0],
          },
        });
      }
      // The crisp service-area picture, over the coarse globe. It fades in as the flight closes on
      // the provinces and cross-fades to the live map at the very end, so the zoom-in never blurs.
      if (!map.getSource(INTRO_REGION_SOURCE)) {
        map.addSource(INTRO_REGION_SOURCE, {
          type: "image",
          url: introRegionUrl(night),
          coordinates: INTRO_REGION_BOX,
        });
      }
      if (!map.getLayer(INTRO_REGION_LAYER)) {
        map.addLayer({
          id: INTRO_REGION_LAYER,
          type: "raster",
          source: INTRO_REGION_SOURCE,
          paint: {
            "raster-fade-duration": 0,
            "raster-opacity": [
              "interpolate",
              ["linear"],
              ["zoom"],
              goal - 2.8,
              0,
              goal - 1.3,
              1,
              goal - 0.25,
              1,
              goal - 0.02,
              0,
            ],
          },
        });
      }
    } catch {
      // No Earth picture this time; the flight still plays over the ordinary map.
    }
    /*
     * No atmosphere halo. The Earth picture is Web Mercator and stops near 85 degrees, so it is a
     * touch smaller than the full sphere the halo would ring; that left a faint second, smaller
     * globe inside the glow (the owner, 25 Oct 2026). Turned off, there is just the one clean Earth
     * on black.
     */
    try {
      map.setSky({ "atmosphere-blend": 0 });
    } catch {
      // Nothing to turn off.
    }
    // A globe up high that flattens into the ordinary map before the end of the descent.
    map.setProjection({
      type: ["interpolate", ["linear"], ["zoom"], 0, "vertical-perspective", goal - 1, "mercator"],
    } as never);
    hideBasemap();
  };
  // The Earth and the crisp service-area picture are kept on top after any redraw, in that order,
  // so a layer a redraw adds can never cover them while the flight is on.
  const lift = () => {
    hideBasemap();
    if (map.getLayer(INTRO_LAYER)) map.moveLayer(INTRO_LAYER);
    if (map.getLayer(INTRO_REGION_LAYER)) map.moveLayer(INTRO_REGION_LAYER);
  };
  container.setAttribute("data-map-intro", "wait");
  dress();
  map.setMaxBounds(null);
  map.setMinZoom(0);
  /*
   * A large round Earth, centred on Jaga's part of the world, with its two poles just off the top
   * and bottom of the view. Web Mercator imagery stops near 85 degrees, and some machines draw the
   * last sliver to the pole as a stretched point ("a lemon", the owner, 25 Oct 2026) - so the poles
   * are kept off screen, where there is nothing to misdraw, while the globe still curves away on
   * the left and right. About 172 px across at zoom 0, doubling with each step.
   */
  const height = map.getCanvas().clientHeight || 600;
  const fit = Math.log2((1.35 * height) / 172);
  map.jumpTo({
    center: [center.lng, center.lat],
    zoom: Math.max(1.8, fit),
    bearing: 0,
    pitch: 0,
  });

  let done = false;
  const stops = ["pointerdown", "mousedown", "touchstart", "wheel"] as const;
  const finish = () => {
    if (done) return;
    done = true;
    // Anywhere on the page, not only the canvas: the zoom, locate and reset buttons sit outside it.
    stops.forEach((name) => window.removeEventListener(name, interrupt, true));
    window.removeEventListener("keydown", interrupt);
    map.off("moveend", finish);
    map.off("sourcedata", loadedYet);
    window.clearTimeout(wait);
    map.off("style.load", dress);
    map.off("styledata", lift);
    map.off("zoom", revealAt);
    reveal();
    map.getContainer().removeAttribute("data-map-intro");
    map.setProjection({ type: "mercator" });
    try {
      map.setSky(sky ?? { "atmosphere-blend": 0 });
    } catch {
      // Left as it is.
    }
    map.setMinZoom(minZoom);
    if (maxBounds) map.setMaxBounds(maxBounds);
    if (map.getLayer(INTRO_REGION_LAYER)) map.removeLayer(INTRO_REGION_LAYER);
    if (map.getSource(INTRO_REGION_SOURCE)) map.removeSource(INTRO_REGION_SOURCE);
    if (map.getLayer(INTRO_LAYER)) map.removeLayer(INTRO_LAYER);
    if (map.getSource(INTRO_SOURCE)) map.removeSource(INTRO_SOURCE);
  };
  function interrupt() {
    map.stop();
    finish();
  }
  // Capture phase, before the button's own click handler moves the map.
  stops.forEach((name) =>
    window.addEventListener(name, interrupt, { passive: true, once: true, capture: true }),
  );
  window.addEventListener("keydown", interrupt, { once: true });
  map.on("style.load", dress);
  map.on("styledata", lift);
  map.on("zoom", revealAt);
  // Leave only when the Earth tiles are in (or after 5 s), or the descent starts over black.
  let started = false;
  const start = () => {
    if (started || done) return;
    started = true;
    container.setAttribute("data-map-intro", "fly");
    map.off("sourcedata", loadedYet);
    window.clearTimeout(wait);
    try {
      sessionStorage.setItem(INTRO_KEY, "1");
    } catch {
      // Private window: it may play again next time.
    }
    map.flyTo({
      center: [center.lng, center.lat],
      zoom: goal,
      duration: INTRO_MS,
      curve: 1.5,
      easing: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
      essential: false,
    });
    map.once("moveend", finish);
  };
  const wait = window.setTimeout(start, 5000);
  const loadedYet = () => {
    if (map.getSource(INTRO_SOURCE) && map.isSourceLoaded(INTRO_SOURCE)) start();
  };
  map.on("sourcedata", loadedYet);
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
  /**
   * A closer look than the default, for a box that is meant to be filled by one thing: the
   * reservoir, when somebody asks to be shown where it is (the owner, 18 Oct 2026).
   */
  look: { minSpan?: { lon: number; lat: number }; margin?: number } = {},
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
  const span = look.minSpan ?? MIN_SPAN;
  const growLon = Math.max(0, span.lon - (east - west)) / 2;
  const growLat = Math.max(0, span.lat - (north - south)) / 2;
  const [w, s, e, n] = [west - growLon, south - growLat, east + growLon, north + growLat];
  // A margin, so a pin on the edge of the box is not drawn half under the edge of the screen.
  const air = look.margin ?? MARGIN;
  const margin = { lon: (e - w) * air, lat: (n - s) * air };
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

/*
 * The four provinces at a glance (the owner, 15 Oct 2026). With the whole service area in view
 * the map shows only the four province outlines and their four capitals; the 377 tambon outlines
 * and the basemap's own names (villages, roads, other towns) come back once the reader zooms in a
 * little. The alert colours of the tambons stay at every zoom: they are a status, not a detail.
 */
export const PROVINCE_SOURCE = "jaga-provinces";
export const PROVINCES_URL = "/api/geo/provinces";
export const PROVINCE_LINE_LAYER = "jaga-province-line";
export const CAPITAL_LAYER = "jaga-capitals";

/**
 * Each province's capital town (the centre of Amphoe Mueang), named on the map with the province's
 * own name. Data, not words: the name comes from the province table in the reader's language.
 */
export const PROVINCE_CAPITALS: Record<string, [number, number]> = {
  "90": [100.5951, 7.1898],
  "94": [101.2502, 6.8693],
  "95": [101.2804, 6.541],
  "96": [101.8253, 6.4255],
};

/** How far past the four-province view the reader zooms before the detail comes back. */
export const DETAIL_STEP = 0.4;

/*
 * The names of the areas themselves, as the reader zooms in (the owner, 18 Oct 2026): the four
 * provinces are named at the overview, the districts once the detail comes back, and the tambons
 * a few steps further, by the time the map is about the extent of someone's own place. The
 * basemap cannot do this - OpenFreeMap names towns and villages, not amphoe and tambon - so the
 * names are Jaga's own (lib/area-labels.ts), drawn from the area list the page already has.
 */
export const AREA_LABEL_SOURCE = "jaga-area-labels";
export const DISTRICT_LABEL_LAYER = "jaga-district-labels";
export const TAMBON_LABEL_LAYER = "jaga-tambon-labels";
/** How far past the overview the tambon names wait: about one province filling the map. */
export const TAMBON_LABEL_STEP = 2.4;

/** The zoom each kind of name starts at, given this map's own four-province zoom. */
export function labelSteps(overview: number): { district: number; tambon: number } {
  return {
    district: detailZoom(overview),
    tambon: Math.round((overview + TAMBON_LABEL_STEP) * 100) / 100,
  };
}

/**
 * Where our own area names belong in the order: above our fills, so the alert colours and the
 * risk shading do not cover them, but before the basemap's own names, which is what makes
 * MapLibre place ours first and drop a village name that collides with a tambon name rather than
 * the other way about. Undefined when the basemap has no names (yet), which puts them on top.
 */
export function beforeBasemapLabels(layers: { id: string; type: string }[]): string | undefined {
  return layers.find((l) => l.type === "symbol" && !l.id.startsWith("jaga-"))?.id;
}

/** The zoom from which tambons and the basemap's names are drawn, given the overview's zoom. */
export function detailZoom(overview: number): number {
  return Math.round((overview + DETAIL_STEP) * 100) / 100;
}

/**
 * The basemap's village and hamlet names (OpenFreeMap's `label_village` and `label_other`, the
 * same ids in its light and dark styles). Towns, cities and roads are not these: they still come
 * back with the detail, because a reader who has zoomed in a little wants to know where Hat Yai is.
 */
export function isVillageLabel(id: string): boolean {
  return /(^|[_-])(village|hamlet|suburb|neighbourhood|other)$/.test(id);
}

/** A basemap name keeps its own starting zoom when that is already later than ours. */
export function labelMinzoom(original: number | undefined, detail: number): number {
  return Math.max(original ?? 0, detail);
}

export function provinceLinePaint(dark: boolean, photo: boolean) {
  return photo
    ? { "line-color": "#f2f5f3", "line-width": 2, "line-opacity": 0.85 }
    : { "line-color": dark ? "#cfe0e8" : SLATE, "line-width": 1.8, "line-opacity": 0.9 };
}

const originalMinzoom = new WeakMap<MapLibreMap, Map<string, number | undefined>>();

/**
 * Hide the tambon outlines and the basemap's names (and `ownLabels`, our own text-only layers)
 * while the whole service area is in view, and show the four capitals then instead. The zoom is worked out from this map's own size, so a
 * phone and a laptop both switch just past their own four-province view. Safe to call on every
 * draw: it changes a layer only when its zoom range differs.
 */
export function quietOverview(map: MapLibreMap, ownLabels: readonly string[] = []): void {
  const camera = map.cameraForBounds(
    [
      [SERVICE_BOUNDS[0], SERVICE_BOUNDS[1]],
      [SERVICE_BOUNDS[2], SERVICE_BOUNDS[3]],
    ],
    { padding: 8 },
  );
  if (!camera || typeof camera.zoom !== "number") return;
  const detail = detailZoom(camera.zoom);
  const range = (id: string, min: number, max: number) => {
    const layer = map.getLayer(id);
    if (!layer) return;
    if (layer.minzoom === min && layer.maxzoom === max) return;
    map.setLayerZoomRange(id, min, max);
  };
  range(TAMBON_LINE_LAYER, detail, 24);
  range(CAPITAL_LAYER, 0, detail);
  // District names from the same step as the detail, tambon names a few steps further in.
  const steps = labelSteps(camera.zoom);
  range(DISTRICT_LABEL_LAYER, steps.district, 24);
  range(TAMBON_LABEL_LAYER, steps.tambon, 24);
  let originals = originalMinzoom.get(map);
  if (!originals) originalMinzoom.set(map, (originals = new Map()));
  for (const layer of map.getStyle().layers) {
    if (layer.type !== "symbol") continue;
    if (layer.id.startsWith("jaga-") && !ownLabels.includes(layer.id)) continue;
    if (!originals.has(layer.id)) originals.set(layer.id, layer.minzoom);
    /*
     * Village names wait for the tambon names (the owner, 24 Oct 2026: "the village labels should
     * only appear when zoom in very near to a tambon boundary ... it's too crowded"). Until then
     * a province on the screen is a thousand hamlet names over the risk shading and the alert
     * colours; at the tambon step the map is about one province wide, which is where a village
     * name starts to mean something.
     */
    const from = isVillageLabel(layer.id) ? Math.max(detail, steps.tambon) : detail;
    range(layer.id, labelMinzoom(originals.get(layer.id), from), layer.maxzoom ?? 24);
  }
}
