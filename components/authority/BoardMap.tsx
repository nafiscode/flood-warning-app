"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import type {
  DataDrivenPropertyValueSpecification,
  FilterSpecification,
  GeoJSONSource,
  Map as MapLibreMap,
} from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { caseFeatures, CLOSED_GREY, SOS_RED, TEAL } from "@/components/authority/marks";
import { isGap, type CoverageRow } from "@/lib/coverage";
import type { BoardCase } from "@/lib/dispatch";
import {
  createServiceAreaMap,
  setBasemap,
  type Basemap,
  mapHalo,
  mapInk,
  TAMBON_FILL_LAYER,
  TAMBON_LINE_LAYER,
  TAMBON_SOURCE,
} from "@/lib/map";

/**
 * The team's board on a map (spec 5.1) and the responsibility map (5.6), one canvas in two
 * modes.
 *
 * Colour follows the rule of every other map in Jaga. The only hue that carries a state is the
 * SOS red, for a case no team holds; a case this team holds is a filled mark in the map ink, one
 * another team holds a hollow ring, a finished one a small grey dot. Coverage is one teal for
 * "a rescue team covers this" and the map ink for a gap: a missing team is not an alert level,
 * so no alert colour is used for it. The legend beside the map says each of these in words.
 */

const CASES = "jaga-ab-cases";
const COVER = "jaga-ab-cover";
const MINE = "jaga-ab-mine";
const PICKED = "jaga-ab-picked";
const SELECTED = "jaga-ab-selected";

export type BoardMapMode = "cases" | "coverage";

const codes = (rows: CoverageRow[], keep: (r: CoverageRow) => boolean) =>
  rows.filter(keep).map((r) => r.tambon);

type Box = [[number, number], [number, number]];

/** The smallest box around some points, or null when there are none. */
export function boxAround(points: [number, number][]): Box | null {
  if (points.length === 0) return null;
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const [lon, lat] of points) {
    if (lon < west) west = lon;
    if (lon > east) east = lon;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }
  return [
    [west, south],
    [east, north],
  ];
}

/** Every corner of the outlines the map has loaded for these tambons. */
function outlinePoints(m: MapLibreMap, tambons: string[]): [number, number][] {
  if (tambons.length === 0) return [];
  const wanted = new Set(tambons);
  const found: [number, number][] = [];
  const walk = (value: unknown) => {
    if (!Array.isArray(value)) return;
    if (typeof value[0] === "number" && typeof value[1] === "number") {
      found.push([value[0], value[1]]);
      return;
    }
    for (const inner of value) walk(inner);
  };
  for (const feature of m.querySourceFeatures(TAMBON_SOURCE)) {
    if (!wanted.has(String(feature.properties?.code))) continue;
    walk((feature.geometry as { coordinates?: unknown }).coordinates);
  }
  return found;
}

const among = (list: string[]): FilterSpecification =>
  ["in", ["get", "code"], ["literal", list]] as unknown as FilterSpecification;

type Props = {
  cases: BoardCase[];
  coverage: CoverageRow[] | null;
  mode: BoardMapMode;
  /** The tambon whose teams are listed beside the map. */
  picked: string | null;
  onPickCase: (sosId: string) => void;
  onPickTambon: (code: string) => void;
  text: { loading: string; failed: string };
  /** The ground under the marks: the main map's own four (lib/map.ts). */
  basemap?: Basemap;
  /** The case open beside the map, ringed and brought into view. */
  selected?: string | null;
  /** The map's size; the war room fills the space it is given. */
  className?: string;
};

export function BoardMap({
  cases,
  coverage,
  mode,
  picked,
  onPickCase,
  onPickTambon,
  text,
  basemap = "streets",
  selected = null,
  className = "h-[50vh] min-h-72 w-full overflow-hidden rounded-xl border border-jaga-line lg:h-[60vh]",
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const held = useRef<GeoJSON.FeatureCollection | null>(null);
  // What the map was last framed on, and whether a hand has moved it since: the map opens on
  // the team's own ground rather than on four provinces, and never snatches the view back.
  const framed = useRef("");
  const moved = useRef(false);
  const draw = useRef<() => void>(() => {});
  // The basemap the map was made with, and the one it shows now (changed without a new map).
  const basemapAtStart = useRef(basemap);
  const applied = useRef(basemap);
  const handlers = useRef({ onPickCase, onPickTambon, mode });
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");

  useEffect(() => {
    handlers.current = { onPickCase, onPickTambon, mode };
  }, [onPickCase, onPickTambon, mode]);

  useEffect(() => {
    const points = caseFeatures(cases);
    const rows = coverage ?? [];
    const gaps = codes(rows, isGap);
    const covered = codes(rows, (r) => !isGap(r));
    const mine = codes(rows, (r) => r.mine);
    draw.current = () => {
      const m = map.current;
      if (!m) return;
      // Read on every draw: after sunset the ink and the halo turn light (lib/map.ts).
      const ink = mapInk();
      const halo = mapHalo();
      try {
        const source = m.getSource(CASES) as GeoJSONSource | undefined;
        if (!source) m.addSource(CASES, { type: "geojson", data: points });
        else if (held.current !== points) source.setData(points);
        held.current = points;

        const above = m.getLayer(TAMBON_LINE_LAYER) ? TAMBON_LINE_LAYER : undefined;
        if (!m.getLayer(COVER)) {
          m.addLayer({ id: COVER, type: "fill", source: TAMBON_SOURCE, paint: {} }, above);
        }
        if (!m.getLayer(MINE)) {
          m.addLayer({
            id: MINE,
            type: "line",
            source: TAMBON_SOURCE,
            paint: { "line-color": TEAL, "line-width": 2.5 },
          });
        }
        if (!m.getLayer(PICKED)) {
          m.addLayer({
            id: PICKED,
            type: "line",
            source: TAMBON_SOURCE,
            paint: { "line-color": ink, "line-width": 3.5 },
          });
        }
        if (!m.getLayer(CASES)) {
          m.addLayer({
            id: CASES,
            type: "circle",
            source: CASES,
            paint: {
              "circle-radius": ["match", ["get", "state"], 0, 11, 1, 10, 2, 9, 3, 7, 6],
              "circle-color": [
                "match",
                ["get", "state"],
                0,
                SOS_RED,
                1,
                ink,
                2,
                halo,
                3,
                halo,
                CLOSED_GREY,
              ],
              "circle-stroke-color": ["match", ["get", "state"], 2, ink, 3, CLOSED_GREY, halo],
              "circle-stroke-width": ["match", ["get", "state"], 4, 1.5, 3],
            },
          });
        }
        if (!m.getLayer(SELECTED)) {
          m.addLayer({
            id: SELECTED,
            type: "circle",
            source: CASES,
            filter: ["==", ["get", "id"], ""],
            paint: {
              "circle-radius": 17,
              "circle-color": "rgba(0,0,0,0)",
              "circle-stroke-color": ink,
              "circle-stroke-width": 3,
            },
          });
        }
        m.setFilter(SELECTED, ["==", ["get", "id"], selected ?? ""]);
        m.setPaintProperty(SELECTED, "circle-stroke-color", ink);
        m.setLayoutProperty(SELECTED, "visibility", mode === "cases" ? "visible" : "none");
        // A gap is the map ink, a covered tambon the teal: built from the data, so TypeScript
        // can't see the tuple MapLibre wants.
        const fill = (gaps.length || covered.length
          ? [
              "match",
              ["get", "code"],
              ...(gaps.length ? [gaps, ink] : []),
              ...(covered.length ? [covered, TEAL] : []),
              TEAL,
            ]
          : TEAL) as unknown as DataDrivenPropertyValueSpecification<string>;
        const opacity = (gaps.length || covered.length
          ? [
              "match",
              ["get", "code"],
              ...(gaps.length ? [gaps, 0.42] : []),
              ...(covered.length ? [covered, 0.2] : []),
              0,
            ]
          : 0) as unknown as DataDrivenPropertyValueSpecification<number>;
        m.setPaintProperty(COVER, "fill-color", fill);
        m.setPaintProperty(COVER, "fill-opacity", opacity);
        m.setPaintProperty(PICKED, "line-color", ink);
        m.setFilter(MINE, among(mine));
        m.setFilter(PICKED, among(picked ? [picked] : []));
        m.setLayoutProperty(COVER, "visibility", mode === "coverage" ? "visible" : "none");
        m.setLayoutProperty(PICKED, "visibility", mode === "coverage" ? "visible" : "none");
        m.setLayoutProperty(CASES, "visibility", mode === "cases" ? "visible" : "none");

        // Frame the open cases, or the team's own tambons when there are none or in the
        // coverage view. Tried again on the next draw until the outlines have arrived.
        const open = points.features
          .filter((f) => f.properties?.state !== 4)
          .map((f) => (f.geometry as GeoJSON.Point).coordinates as [number, number]);
        const key = `${mode}:${mine.length}:${open.length}`;
        if (framed.current !== key && !moved.current) {
          const box =
            (mode === "cases" ? boxAround(open) : null) ?? boxAround(outlinePoints(m, mine));
          if (box) {
            m.fitBounds(box, { padding: 48, maxZoom: 12, duration: 0 });
            framed.current = key;
          }
        }
      } catch {
        // The style is being replaced: the next "styledata" or "idle" draws again.
      }
    };
    draw.current();
  }, [cases, coverage, mode, picked, selected]);

  // A case picked in the list is brought into view; a hand on the map is never overruled by
  // anything else, but picking is a hand too.
  useEffect(() => {
    const m = map.current;
    if (!m || !selected || state !== "ready") return;
    const target = cases.find((c) => c.sosId === selected);
    if (!target) return;
    m.easeTo({ center: [target.lon, target.lat], zoom: Math.max(m.getZoom(), 13), duration: 500 });
    moved.current = true;
  }, [selected, state]); // eslint-disable-line react-hooks/exhaustive-deps -- only when the pick changes

  useEffect(() => {
    const m = map.current;
    if (!m || state !== "ready" || applied.current === basemap) return;
    applied.current = basemap;
    setBasemap(m, basemap);
  }, [basemap, state]);

  useEffect(() => {
    if (!container.current) return;
    let cancelled = false;
    createServiceAreaMap(container.current, basemapAtStart.current)
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
        created.on("style.load", () => {
          held.current = null;
        });
        created.on("dragstart", () => {
          moved.current = true;
        });
        created.on("zoomstart", (event) => {
          // Only a hand on the map counts; our own framing has no original event.
          if ((event as { originalEvent?: unknown }).originalEvent) moved.current = true;
        });
        created.on("styledata", redraw);
        created.on("idle", redraw);
        created.on("click", (event) => {
          const now = handlers.current;
          if (now.mode === "cases") {
            if (!created.getLayer(CASES)) return;
            const hit = created.queryRenderedFeatures(event.point, { layers: [CASES] })[0];
            const id = hit?.properties?.id;
            if (id) now.onPickCase(String(id));
            return;
          }
          if (!created.getLayer(TAMBON_FILL_LAYER)) return;
          const hit = created.queryRenderedFeatures(event.point, {
            layers: [TAMBON_FILL_LAYER],
          })[0];
          const code = hit?.properties?.code;
          if (code) now.onPickTambon(String(code));
        });
      })
      .catch(() => setState("failed"));
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
  }, []);

  if (state === "failed") {
    return (
      <p role="alert" className="rounded-xl border border-jaga-line bg-jaga-surface px-4 py-3">
        {text.failed}
      </p>
    );
  }
  return (
    <div className="relative h-full">
      <div
        ref={container}
        data-map="true"
        data-map-mode={mode}
        data-map-ready={state === "ready"}
        className={className}
      />
      {state === "loading" && (
        <p className="absolute inset-x-0 top-3 text-center text-small text-jaga-text-2">
          {text.loading}
        </p>
      )}
    </div>
  );
}
