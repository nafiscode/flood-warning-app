import type { Map as MapLibreMap, StyleSpecification } from "maplibre-gl";
import { darkNow } from "@/lib/map";

/**
 * The map under the weather grids. It is not the service-area map (lib/map.ts): the weather is
 * shown for whatever place the person picked, which may be anywhere in the world, so there are
 * no tambon outlines on it and no bounds holding it over the four provinces.
 */
const BASEMAP = "https://tiles.openfreemap.org/styles/positron";
const BASEMAP_DARK = "https://tiles.openfreemap.org/styles/dark";
const GROUND = "#f0f2ee";
const GROUND_DARK = "#0f1c26";

const startStyle = (dark: boolean): StyleSpecification => ({
  version: 8,
  glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
  sources: {},
  layers: [
    {
      id: "jaga-ground",
      type: "background",
      paint: { "background-color": dark ? GROUND_DARK : GROUND },
    },
  ],
});

export type Box = [number, number, number, number];

/** The map, with the grid's square already filling it. MapLibre is loaded here, never with the page. */
export async function createWeatherMap(container: HTMLElement, box: Box): Promise<MapLibreMap> {
  const maplibre = await import("maplibre-gl");
  maplibre.setWorkerUrl(`/vendor/maplibre/${maplibre.getVersion()}/maplibre-gl-worker.mjs`);
  const map = new maplibre.Map({
    container,
    style: startStyle(darkNow()),
    bounds: [
      [box[0], box[1]],
      [box[2], box[3]],
    ],
    fitBoundsOptions: { padding: 8 },
    dragRotate: false,
    pitchWithRotate: false,
    attributionControl: { compact: true },
  });
  map.touchZoomRotate.disableRotation();
  map.addControl(new maplibre.NavigationControl({ showCompass: false }), "top-right");

  // The credits start folded behind their (i) button, and fold again each time the style is
  // replaced: opened, they cover the bottom third of a phone's map.
  const foldCredits = () => {
    const credits = container.querySelector(".maplibregl-ctrl-attrib");
    if (!credits?.classList.contains("maplibregl-compact-show")) return;
    credits.classList.remove("maplibregl-compact-show");
    credits.removeAttribute("open");
  };
  // Every one of these: the basemap re-opens the panel when it swaps the style in, and waiting
  // for "idle" left it covering the map for the few seconds the tiles take.
  map.on("style.load", foldCredits);
  map.on("sourcedata", foldCredits);
  map.on("idle", foldCredits);

  map.once("load", () => {
    foldCredits();
    // The street basemap arrives under our own layers, which are already drawn by then.
    map.setStyle(darkNow() ? BASEMAP_DARK : BASEMAP, {
      transformStyle: (previous, next) => {
        if (!previous) return next;
        const own = previous.layers.filter(
          (l) => l.id.startsWith("jaga-") && l.id !== "jaga-ground",
        );
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
  // A basemap that cannot be reached must not take the weather cells with it.
  map.on("error", () => {});
  return map;
}
