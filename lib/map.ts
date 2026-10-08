import type { Map as MapLibreMap, StyleSpecification } from "maplibre-gl";

/** The four covered provinces, with a little margin: [west, south, east, north]. */
export const SERVICE_BOUNDS: [number, number, number, number] = [99.95, 5.55, 102.25, 8.0];

/** OpenFreeMap: free, no API key (CLAUDE.md, Maps). */
const BASEMAP_STYLE = "https://tiles.openfreemap.org/styles/positron";

export const TAMBON_SOURCE = "jaga-tambons";
export const TAMBONS_URL = "/api/geo/tambons";
const BOUNDARY_CREDIT = "Boundaries: Royal Thai Survey Department via OCHA (CC BY-IGO)";

// Brand colors (docs/brand.md). Map layers can't read CSS variables.
const SLATE = "#1d3b53";
const TEAL = "#2f9c95";
const GROUND = "#f0f2ee";

const START_STYLE: StyleSpecification = {
  version: 8,
  // The same free font server the basemap uses, so our own labels can be drawn before (and
  // without) the basemap. No key, same host as the tiles.
  glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
  sources: {
    [TAMBON_SOURCE]: { type: "geojson", data: TAMBONS_URL, attribution: BOUNDARY_CREDIT },
  },
  layers: [
    { id: "jaga-ground", type: "background", paint: { "background-color": GROUND } },
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
      paint: { "line-color": SLATE, "line-width": 0.8, "line-opacity": 0.6 },
    },
  ],
};

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
    style: START_STYLE,
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
    map.setStyle(BASEMAP_STYLE, {
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
