"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import type {
  DataDrivenPropertyValueSpecification,
  GeoJSONSource,
  Map as MapLibreMap,
} from "maplibre-gl";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import {
  createServiceAreaMap,
  mapHalo,
  mapInk,
  SERVICE_BOUNDS,
  TAMBON_LINE_LAYER,
  TAMBON_SOURCE,
} from "@/lib/map";
import { caseState, type CaseState, type SosCase, type WarRoomMapData } from "@/lib/war-room";

/**
 * The war room on a map: the open cases, where people live, how many places are watched per
 * tambon, and the flood reports of the last three days.
 *
 * Colour here follows the same rule as everywhere else in Jaga. The only hue that carries a state
 * is the SOS red, for a case nobody has answered; a case a unit holds is a hollow ring in the map
 * ink, a closed one a small grey dot, and the legend names each of them in words. Density is one
 * teal hue, light to dark, because a count is not a status. The ink and the halo turn light after
 * sunset, with the dark basemap (lib/map.ts).
 */

const SOS_RED = "#c62828";
const CLOSED_GREY = "#6b7780";
const TEAL = "#2f9c95";

const DENSITY = "jaga-wr-density";
const HOMES = "jaga-wr-homes";
const REPORTS = "jaga-wr-reports";
const CASES = "jaga-wr-cases";

export type MapLayerKey = "density" | "homes" | "reports" | "cases";

/** How many homes and watched places a tambon needs for each step of the teal ramp. */
export const DENSITY_STEPS = [1, 3, 10, 30, 100];

type Collection = GeoJSON.FeatureCollection;
const collection = (features: GeoJSON.Feature[]): Collection => ({
  type: "FeatureCollection",
  features,
});

const point = (
  lon: number,
  lat: number,
  properties: GeoJSON.GeoJsonProperties,
): GeoJSON.Feature => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: [lon, lat] },
  properties,
});

/** The case states as a number the map can switch on: 0 answered by nobody, 1 held, 2 closed. */
const STATE_CODE: Record<CaseState, number> = { overdue: 0, waiting: 0, working: 1, closed: 2 };

function collections(
  cases: SosCase[],
  data: WarRoomMapData,
  now: number,
  unclaimedMinutes: number,
): Record<string, Collection> {
  return {
    [CASES]: collection(
      cases
        .filter((c) => c.lat != null && c.lon != null)
        .map((c) =>
          point(c.lon!, c.lat!, {
            id: c.id,
            state: STATE_CODE[caseState(c, now, unclaimedMinutes)],
            overdue: caseState(c, now, unclaimedMinutes) === "overdue" ? 1 : 0,
          }),
        ),
    ),
    [HOMES]: collection(data.people.map((p) => point(p.lon, p.lat, {}))),
    [REPORTS]: collection(
      data.reports
        .filter((r) => r.lat != null && r.lon != null)
        .map((r) => point(r.lon!, r.lat!, { id: r.id })),
    ),
  };
}

/** The teal ramp as a match expression over the tambon codes in each bucket. */
function densityOpacity(data: WarRoomMapData): DataDrivenPropertyValueSpecification<number> {
  const buckets: string[][] = DENSITY_STEPS.map(() => []);
  for (const row of data.watched) {
    const total = row.homes + row.places;
    let step = -1;
    for (let i = 0; i < DENSITY_STEPS.length; i++) if (total >= DENSITY_STEPS[i]!) step = i;
    if (step >= 0) buckets[step]!.push(row.tambon);
  }
  // Light to dark in one hue, five steps.
  const opacity = [0.12, 0.25, 0.4, 0.58, 0.78];
  const cases = buckets.flatMap((codes, i) => (codes.length ? [codes, opacity[i]!] : []));
  if (cases.length === 0) return 0;
  // Built from the data, so TypeScript can't see the tuple MapLibre wants (as in lib/map-style.ts).
  return [
    "match",
    ["get", "code"],
    ...cases,
    0,
  ] as unknown as DataDrivenPropertyValueSpecification<number>;
}

type Props = {
  cases: SosCase[];
  data: WarRoomMapData | null;
  now: number;
  unclaimedMinutes: number;
  shown: MapLayerKey[];
  onPick: (caseId: string) => void;
  text: { loading: string; failed: string };
};

export function WarRoomMap({ cases, data, now, unclaimedMinutes, shown, onPick, text }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const held = useRef(new Map<string, Collection>());
  const draw = useRef<() => void>(() => {});
  const pick = useRef(onPick);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");

  useEffect(() => {
    pick.current = onPick;
  }, [onPick]);

  useEffect(() => {
    const sources = data ? collections(cases, data, now, unclaimedMinutes) : {};
    const show = (key: MapLayerKey) => (shown.includes(key) ? "visible" : "none");
    draw.current = () => {
      const m = map.current;
      if (!m) return;
      // Read on every draw, not once: after sunset the ink and the halo turn light (lib/map.ts).
      const ink = mapInk();
      const halo = mapHalo();
      try {
        for (const [id, value] of Object.entries(sources)) {
          const source = m.getSource(id) as GeoJSONSource | undefined;
          if (!source) m.addSource(id, { type: "geojson", data: value });
          else if (held.current.get(id) !== value) source.setData(value);
          held.current.set(id, value);
        }
        if (!m.getSource(CASES)) return;
        const above = m.getLayer(TAMBON_LINE_LAYER) ? TAMBON_LINE_LAYER : undefined;
        if (!m.getLayer(DENSITY)) {
          m.addLayer(
            { id: DENSITY, type: "fill", source: TAMBON_SOURCE, paint: { "fill-color": TEAL } },
            above,
          );
        }
        if (!m.getLayer(HOMES)) {
          // Where people live: small, faint and the same everywhere. It is a density, not a list
          // of addresses, and nothing on the map says whose home it is.
          m.addLayer({
            id: HOMES,
            type: "circle",
            source: HOMES,
            paint: {
              "circle-radius": ["interpolate", ["linear"], ["zoom"], 7, 2.5, 12, 5],
              "circle-color": ink,
              "circle-opacity": 0.5,
            },
          });
        }
        if (!m.getLayer(REPORTS)) {
          m.addLayer({
            id: REPORTS,
            type: "circle",
            source: REPORTS,
            paint: {
              "circle-radius": 5,
              "circle-color": TEAL,
              "circle-stroke-color": halo,
              "circle-stroke-width": 1.5,
            },
          });
        }
        if (!m.getLayer(CASES)) {
          m.addLayer({
            id: CASES,
            type: "circle",
            source: CASES,
            paint: {
              // An unanswered case is the biggest mark on the map, and the only red one.
              "circle-radius": ["match", ["get", "state"], 0, 11, 1, 9, 6],
              "circle-color": ["match", ["get", "state"], 0, SOS_RED, 1, halo, CLOSED_GREY],
              "circle-stroke-color": ["match", ["get", "state"], 0, halo, 1, ink, halo],
              "circle-stroke-width": ["match", ["get", "state"], 0, 3, 1, 3, 1.5],
            },
          });
        }
        m.setPaintProperty(
          DENSITY,
          "fill-opacity",
          densityOpacity(data ?? { watched: [], people: [], reports: [] }),
        );
        m.setLayoutProperty(DENSITY, "visibility", show("density"));
        m.setLayoutProperty(HOMES, "visibility", show("homes"));
        m.setLayoutProperty(REPORTS, "visibility", show("reports"));
        m.setLayoutProperty(CASES, "visibility", show("cases"));
      } catch {
        // The style is being replaced: the next "styledata" or "idle" draws again.
      }
    };
    draw.current();
  }, [cases, data, now, unclaimedMinutes, shown]);

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
        created.on("style.load", () => held.current.clear());
        created.on("styledata", redraw);
        created.on("idle", redraw);
        created.on("mousemove", (event) => {
          if (!created.getLayer(CASES)) return;
          const hit = created.queryRenderedFeatures(event.point, { layers: [CASES] })[0];
          created.getCanvas().style.cursor = hit ? "pointer" : "";
        });
        created.on("click", (event) => {
          if (!created.getLayer(CASES)) return;
          const hit = created.queryRenderedFeatures(event.point, { layers: [CASES] })[0];
          const id = hit?.properties?.id;
          if (id) pick.current(String(id));
        });
      })
      .catch(() => setState("failed"));
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    if (state !== "ready") return;
    const [west, south, east, north] = SERVICE_BOUNDS;
    map.current?.fitBounds(
      [
        [west, south],
        [east, north],
      ],
      { padding: 8, duration: 0 },
    );
  }, [state]);

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
        className="h-[55vh] min-h-72 w-full overflow-hidden rounded-xl border border-jaga-line lg:h-[70vh]"
      />
      {state === "loading" && (
        <p className="absolute inset-x-0 top-3 text-center text-small text-jaga-text-2">
          {text.loading}
        </p>
      )}
    </div>
  );
}

/** The legend, in words beside every mark. Shown next to the map, not inside it. */
export function MapLegend({ shown }: { shown: MapLayerKey[] }) {
  const t = useTranslations("warRoom");
  const dot = (style: React.CSSProperties) => (
    <span aria-hidden="true" className="inline-block size-4 shrink-0 rounded-full" style={style} />
  );
  const rows: { key: MapLayerKey; mark: React.ReactNode; text: string }[] = [
    { key: "cases", mark: dot({ background: SOS_RED }), text: t("legend.waiting") },
    {
      key: "cases",
      mark: dot({ background: "transparent", boxShadow: "inset 0 0 0 3px var(--jaga-text)" }),
      text: t("legend.working"),
    },
    { key: "cases", mark: dot({ background: CLOSED_GREY }), text: t("legend.closed") },
    {
      key: "homes",
      mark: dot({ background: "var(--jaga-text)", opacity: 0.5, transform: "scale(0.6)" }),
      text: t("legend.homes"),
    },
    {
      key: "reports",
      mark: dot({ background: TEAL, transform: "scale(0.8)" }),
      text: t("legend.reports"),
    },
    {
      key: "density",
      mark: (
        <span aria-hidden="true" className="inline-flex shrink-0 gap-0.5">
          {[0.12, 0.4, 0.78].map((o) => (
            <span
              key={o}
              className="inline-block size-4 rounded"
              style={{ background: TEAL, opacity: o }}
            />
          ))}
        </span>
      ),
      text: t("legend.density"),
    },
  ];
  return (
    <ul className="flex flex-col gap-2">
      {rows
        .filter((r) => shown.includes(r.key))
        .map((r, i) => (
          <li key={i} className="flex items-center gap-2 text-small">
            {r.mark}
            <span>{r.text}</span>
          </li>
        ))}
    </ul>
  );
}
