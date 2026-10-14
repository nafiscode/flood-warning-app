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
 *   terrain    the same streets with the hills shaded from open elevation tiles (Mapzen's
 *              Terrarium set on AWS), so it follows day and night as well.
 *   satellite  Esri World Imagery when Jaga has an ArcGIS key (the owner, 14 Oct 2026): satellite
 *              and aerial pictures down to about half a metre in towns, so single houses show.
 *              Without a key, or once Esri stops answering (the free allowance is 2 million tiles
 *              a month; past it the tiles stop, since pay-as-you-go is left off), Sentinel-2
 *              cloudless by EOX: a cloud-free picture of 2020 at about 10 m. A photograph has no
 *              night version, so it always looks like day.
 */
export const BASEMAPS = ["streets", "terrain", "satellite"] as const;
export type Basemap = (typeof BASEMAPS)[number];
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
const TERRAIN_TILES = "https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png";
const TERRAIN_CREDIT = "Elevation: Mapzen terrain tiles on AWS (SRTM, GMTED and others)";

let chosen: Basemap = "streets";
/** Whether the map itself is dark right now: at night, except on the satellite picture. */
export const mapIsDark = () => darkNow() && chosen !== "satellite";

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
      paint: {
        "line-color": dark ? "#cfe0e8" : SLATE,
        "line-width": 0.8,
        "line-opacity": dark ? 0.5 : 0.6,
      },
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

/** The satellite picture as a whole style: one raster layer, and the font server our labels need. */
const satelliteStyle = (): StyleSpecification => ({
  version: 8,
  glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
  sources: {
    "jaga-base-satellite": satelliteSource(satelliteProvider()),
  },
  layers: [{ id: "jaga-base-satellite", type: "raster", source: "jaga-base-satellite" }],
});

/**
 * Put another basemap under our own layers. Everything of ours (sources with the data they hold,
 * and the layers in their order) is carried across; only the basemap's own parts are replaced.
 * The caller draws again on "styledata", which also recolours our outlines for the new ground.
 */
export function setBasemap(map: MapLibreMap, basemap: Basemap): void {
  chosen = basemap;
  const dark = mapIsDark();
  const style =
    basemap === "satellite" ? satelliteStyle() : dark ? BASEMAP_STYLE_DARK : BASEMAP_STYLE;
  map.setStyle(style, {
    transformStyle: (previous, next) => {
      const base: StyleSpecification =
        basemap === "terrain"
          ? {
              ...next,
              sources: {
                ...next.sources,
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
                ...next.layers,
                {
                  id: "jaga-base-hillshade",
                  type: "hillshade",
                  source: "jaga-base-dem",
                  paint: {
                    "hillshade-exaggeration": 0.55,
                    "hillshade-shadow-color": dark ? "#000000" : "#3b4a57",
                    "hillshade-highlight-color": dark ? "#5d7382" : "#ffffff",
                    "hillshade-accent-color": dark ? "#0b1117" : "#6b7780",
                  },
                },
              ],
            }
          : next;
      if (!previous) return base;
      const own = previous.layers.filter(
        (l) => l.id.startsWith("jaga-") && !BASE_PARTS.includes(l.id),
      );
      // Every source of ours comes along, with whatever data it holds by now.
      const ownSources = Object.fromEntries(
        Object.entries(previous.sources).filter(
          ([id]) => id.startsWith("jaga-") && !BASE_SOURCES.includes(id),
        ),
      );
      return {
        ...base,
        sources: { ...base.sources, ...ownSources },
        layers: [...base.layers, ...own],
      };
    },
  });
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
    const source = (event as { sourceId?: string }).sourceId;
    if (source !== "jaga-base-satellite" || satelliteProvider() !== "esri") return;
    esriErrors += 1;
    if (esriErrors < ESRI_FAILS_BEFORE_FALLBACK) return;
    esriFailed = true;
    if (chosen === "satellite") setBasemap(map, "satellite");
    for (const listener of satelliteListeners) listener();
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
