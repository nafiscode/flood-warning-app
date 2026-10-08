"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import type { MapLayer } from "@/lib/hazards";
import {
  createServiceAreaMap,
  SERVICE_BOUNDS,
  TAMBON_FILL_LAYER,
  TAMBON_LINE_LAYER,
  TAMBON_SOURCE,
} from "@/lib/map";
import type { MapData } from "@/lib/map-data";
import { alertFillColor, STALE_COLOR, staleTambons } from "@/lib/map-style";
import type { PublicStatus } from "@/lib/public-status";

export type MapSelection =
  | { kind: "tambon"; code: string; nameTh: string; nameEn: string }
  | { kind: "place"; id: string }
  | { kind: "reports"; index: number }
  | { kind: "gauge"; id: string }
  | { kind: "mine"; id: string };

/**
 * A place of the person's own: their home, or one they watch for someone (spec 4.9). It is
 * drawn only in their own browser, from their own session (/api/me/places); nothing personal
 * reaches the public map data (safety rule 6).
 */
export type MinePlace = { id: string; label: string; lat: number; lon: number; home: boolean };

type Props = {
  /** What may be drawn. Empty: nothing of ours but the tambon outlines. */
  layers: MapLayer[];
  /** The person's own places, drawn on top of everything when they ask for them. */
  mine?: MinePlace[];
  showMine?: boolean;
  status: PublicStatus | null;
  data: MapData | null;
  now: number;
  /** Where to look: the service area, or one province. */
  bounds?: [number, number, number, number];
  onSelect: (selection: MapSelection) => void;
  text: { loading: string; failed: string };
};

// Brand slate (docs/brand.md): places, reports and gauges carry no status color.
const SLATE = "#1d3b53";
const ALERT_FILL = "jaga-alert-fill";
const ALERT_STALE = "jaga-alert-stale";
const REPORTS = "jaga-reports";
const REPORTS_LINE = "jaga-reports-line";
const PLACES = "jaga-places";
const GAUGES = "jaga-gauges";
const MINE = "jaga-mine";
// Brand teal for the person's own places: it marks whose they are, never a status
// (docs/brand.md; the level is in the card and in the tambon's colour underneath).
const TEAL = "#2f9c95";

type Collection = GeoJSON.FeatureCollection;
const collection = (features: GeoJSON.Feature[]): Collection => ({
  type: "FeatureCollection",
  features,
});

function toCollections(data: MapData | null, mine: MinePlace[]): Record<string, Collection> {
  return {
    [MINE]: collection(
      mine.map((place) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [place.lon, place.lat] },
        properties: { id: place.id, home: place.home ? 1 : 0 },
      })),
    ),
    [REPORTS]: collection(
      (data?.reports ?? []).map((bin, index) => ({
        type: "Feature",
        geometry: bin.hex,
        properties: { index, count: bin.count },
      })),
    ),
    [PLACES]: collection(
      (data?.places ?? []).map((place) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [place.lon, place.lat] },
        properties: { id: place.id },
      })),
    ),
    [GAUGES]: collection(
      (data?.gauges ?? []).map((gauge) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [gauge.lon, gauge.lat] },
        properties: { id: gauge.id },
      })),
    ),
  };
}

/**
 * The public map (spec 4.2): tambons colored by alert level, flood reports as counts per
 * hexagon, safe places and river gauges. MapLibre is downloaded only when this is shown.
 * Drawing is repeated whenever the style changes (the street basemap arrives after our own
 * outlines), so every step here can run any number of times.
 */
export function MapView({
  layers,
  status,
  data,
  now,
  bounds,
  onSelect,
  text,
  mine = [],
  showMine = false,
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  // Which data object each source holds, so data is sent again only when it changed.
  const held = useRef(new Map<string, Collection>());
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const select = useRef(onSelect);
  const draw = useRef<() => void>(() => {});

  useEffect(() => {
    select.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    const collections = toCollections(data, mine);
    const show = (layer: MapLayer) => (layers.includes(layer) ? "visible" : "none");
    draw.current = () => {
      const m = map.current;
      if (!m) return;
      try {
        for (const [id, value] of Object.entries(collections)) {
          const source = m.getSource(id) as GeoJSONSource | undefined;
          if (!source) m.addSource(id, { type: "geojson", data: value });
          else if (held.current.get(id) !== value) source.setData(value);
          held.current.set(id, value);
        }
        const above = m.getLayer(TAMBON_LINE_LAYER) ? TAMBON_LINE_LAYER : undefined;
        if (!m.getLayer(ALERT_FILL)) {
          m.addLayer({ id: ALERT_FILL, type: "fill", source: TAMBON_SOURCE, paint: {} }, above);
        }
        if (!m.getLayer(REPORTS)) {
          m.addLayer(
            {
              id: REPORTS,
              type: "fill",
              source: REPORTS,
              paint: {
                "fill-color": SLATE,
                "fill-opacity": ["interpolate", ["linear"], ["get", "count"], 1, 0.3, 10, 0.7],
              },
            },
            above,
          );
          m.addLayer({
            id: REPORTS_LINE,
            type: "line",
            source: REPORTS,
            paint: { "line-color": SLATE, "line-width": 1.5 },
          });
        }
        if (!m.getLayer(ALERT_STALE)) {
          m.addLayer({
            id: ALERT_STALE,
            type: "line",
            source: TAMBON_SOURCE,
            filter: ["in", ["get", "code"], ["literal", []]],
            paint: { "line-color": STALE_COLOR, "line-width": 3, "line-dasharray": [2, 2] },
          });
        }
        if (!m.getLayer(PLACES)) {
          m.addLayer({
            id: PLACES,
            type: "circle",
            source: PLACES,
            paint: {
              "circle-radius": 7,
              "circle-color": SLATE,
              "circle-stroke-color": "#ffffff",
              "circle-stroke-width": 2,
            },
          });
        }
        if (!m.getLayer(GAUGES)) {
          m.addLayer({
            id: GAUGES,
            type: "circle",
            source: GAUGES,
            paint: {
              "circle-radius": 6,
              "circle-color": "#ffffff",
              "circle-stroke-color": SLATE,
              "circle-stroke-width": 3,
            },
          });
        }
        if (!m.getLayer(MINE)) {
          // On top of the public layers: these few points are what the person came to find.
          m.addLayer({
            id: MINE,
            type: "circle",
            source: MINE,
            paint: {
              "circle-radius": ["case", ["==", ["get", "home"], 1], 9, 8],
              "circle-color": ["case", ["==", ["get", "home"], 1], TEAL, "#ffffff"],
              "circle-stroke-color": TEAL,
              "circle-stroke-width": 3,
            },
          });
        }
        m.setPaintProperty(ALERT_FILL, "fill-color", alertFillColor(status));
        m.setFilter(ALERT_STALE, ["in", ["get", "code"], ["literal", staleTambons(status, now)]]);
        m.setLayoutProperty(ALERT_FILL, "visibility", show("alerts"));
        m.setLayoutProperty(ALERT_STALE, "visibility", show("alerts"));
        m.setLayoutProperty(REPORTS, "visibility", show("reports"));
        m.setLayoutProperty(REPORTS_LINE, "visibility", show("reports"));
        m.setLayoutProperty(PLACES, "visibility", show("places"));
        m.setLayoutProperty(GAUGES, "visibility", show("gauges"));
        m.setLayoutProperty(MINE, "visibility", showMine && mine.length > 0 ? "visible" : "none");
      } catch {
        // The style is being replaced: the next "styledata" or "idle" draws again.
      }
    };
    draw.current();
  }, [layers, status, data, now, mine, showMine]);

  useEffect(() => {
    if (!container.current) return;
    let cancelled = false;
    createServiceAreaMap(container.current)
      .then((created) => {
        if (cancelled) {
          created.remove();
          return;
        }
        map.current = created;
        const redraw = () => draw.current();
        created.once("load", () => {
          redraw();
          setState("ready");
        });
        // After the basemap replaces the style, sources may hold their first data again.
        created.on("style.load", () => held.current.clear());
        created.on("styledata", redraw);
        created.on("idle", redraw);
        created.on("click", (event) => {
          const ids = [MINE, GAUGES, PLACES, REPORTS, TAMBON_FILL_LAYER].filter((id) =>
            created.getLayer(id),
          );
          const hit = created.queryRenderedFeatures(event.point, { layers: ids })[0];
          const p = hit?.properties;
          if (!hit || !p) return;
          if (hit.layer.id === MINE) select.current({ kind: "mine", id: String(p.id) });
          else if (hit.layer.id === GAUGES) select.current({ kind: "gauge", id: String(p.id) });
          else if (hit.layer.id === PLACES) select.current({ kind: "place", id: String(p.id) });
          else if (hit.layer.id === REPORTS) {
            select.current({ kind: "reports", index: Number(p.index) });
          } else {
            select.current({
              kind: "tambon",
              code: String(p.code),
              nameTh: String(p.name_th),
              nameEn: String(p.name_en),
            });
          }
        });
      })
      .catch(() => setState("failed"));
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
  }, []);

  const [west, south, east, north] = bounds ?? SERVICE_BOUNDS;
  useEffect(() => {
    if (state !== "ready") return;
    map.current?.fitBounds(
      [
        [west, south],
        [east, north],
      ],
      { padding: 8, duration: 0 },
    );
  }, [state, west, south, east, north]);

  if (state === "failed") {
    return (
      <p role="alert" className="rounded-xl border border-jaga-line bg-jaga-surface px-4 py-3">
        {text.failed}
      </p>
    );
  }
  return (
    <div className="relative">
      <div
        ref={container}
        data-map="true"
        data-map-ready={state === "ready"}
        className="h-[60vh] min-h-80 w-full overflow-hidden rounded-xl border border-jaga-line"
      />
      {state === "loading" && (
        <p className="absolute inset-x-0 top-3 text-center text-small text-jaga-text-2">
          {text.loading}
        </p>
      )}
    </div>
  );
}
