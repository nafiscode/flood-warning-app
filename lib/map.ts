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
 * The colours our own layers draw with. At night the outlines and dots turn light, or they
 * would disappear into the dark basemap; the alert colours of the tambons never change.
 */
export const mapInk = () => (darkNow() ? "#cfe0e8" : "#1d3b53");
export const mapHalo = () => (darkNow() ? "#0f1c26" : "#ffffff");

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
export async function createServiceAreaMap(container: HTMLElement): Promise<MapLibreMap> {
  const maplibre = await import("maplibre-gl");
  // The worker is served from public/vendor (scripts/vendor-maplibre.mjs), not from the bundle.
  maplibre.setWorkerUrl(`/vendor/maplibre/${maplibre.getVersion()}/maplibre-gl-worker.mjs`);
  const map = new maplibre.Map({
    container,
    style: startStyle(darkNow()),
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
  map.addControl(new maplibre.NavigationControl({ showCompass: false }), "top-right");

  map.once("load", () => {
    // The credits start folded behind their (i) button: opened, they cover a third of a phone map.
    const credits = container.querySelector(".maplibregl-ctrl-attrib");
    credits?.classList.remove("maplibregl-compact-show");
    credits?.removeAttribute("open");
    // Put the basemap under our layers, keeping whatever is selected at that moment.
    map.setStyle(darkNow() ? BASEMAP_STYLE_DARK : BASEMAP_STYLE, {
      transformStyle: (previous, next) => {
        if (!previous) return next;
        const own = previous.layers.filter(
          (l) => l.id.startsWith("jaga-") && l.id !== "jaga-ground",
        );
        // Every source of ours comes along, with whatever data it holds by now.
        const ownSources = Object.fromEntries(
          Object.entries(previous.sources).filter(([id]) => id.startsWith("jaga-")),
        );
        return {
          ...next,
          sources: { ...next.sources, ...ownSources },
          layers: [...next.layers, ...own],
        };
      },
    });
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
