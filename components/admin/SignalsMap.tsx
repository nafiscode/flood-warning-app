"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";
import { SERVICE_BOUNDS } from "@/lib/map";
import type { GaugeState } from "@/lib/signals";

/**
 * Every river gauge on one map, for the admins (the owner, 14 Oct 2026: "hydrological map style,
 * modern futuristic look"). A dark ground, the warning zones' catchments as lit outlines, and each
 * gauge a glowing mark coloured by where its own reading stands against its own levels. The colour
 * never speaks alone: the label under each mark and the panel a tap opens say it in words.
 *
 * The four risk states borrow the alert hues so an admin reads them at a glance, which is the one
 * place outside an issued alert they appear. That is why every mark also carries its words, and the
 * panel says plainly that nothing has been issued.
 */

export type MapPoint = {
  id: string | null;
  code: string;
  name: string;
  agency: string | null;
  zone: string | null;
  lon: number;
  lat: number;
  state: GaugeState;
  value: number | null;
  at: string | null;
  ageH: number | null;
  rise: number | null;
  bank: number | null;
  warning: number | null;
  auto: boolean;
  canAuto: boolean;
  series: [number, number][];
  /** Watch, Warning and Evacuate as the map measures this gauge (lib/signals.ts, mapLevels). */
  levels?: {
    watch: number | null;
    warning: number | null;
    evacuate: number | null;
    provisional: boolean;
    how: string | null;
    floods: number | null;
    bankSuspect: boolean;
    neverReachedBank: boolean;
    isKey: boolean;
  };
};

export type MapWords = {
  title: string;
  hint: string;
  states: Record<GaugeState, string>;
  close: string;
  zone: string;
  noZone: string;
  autoOn: string;
  autoLabel: string;
  autoHint: string;
  save: string;
  level: string;
  measured: string;
  rise: string;
  bank: string;
  warning: string;
  unknown: string;
  notIssued: string;
  levels?: {
    title: string;
    none: string;
    watch: string;
    warning: string;
    evacuate: string;
    provisional: string;
    set: string;
    fromFloods: string;
    fromRise: string;
    key: string;
    bankSuspect: string;
    neverReached: string;
    note: string;
    save: string;
    hint: string;
  };
};

const STATE_COLOR: Record<GaugeState, string> = {
  evacuate: "#c62828",
  warning: "#f07f1a",
  near: "#f2c230",
  normal: "#4fc3d9",
  stale: "#6b7780",
  nolevels: "#9aa7b0",
};
const GLOW: Record<GaugeState, number> = {
  evacuate: 22,
  warning: 18,
  near: 14,
  normal: 9,
  stale: 0,
  nolevels: 0,
};

export function SignalsMap({
  points,
  zones,
  words,
  action,
  levelsAction,
}: {
  points: MapPoint[];
  zones: GeoJSON.FeatureCollection;
  words: MapWords;
  action?: (form: FormData) => void;
  levelsAction?: (form: FormData) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const features = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: "FeatureCollection",
      features: points.map((p) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [p.lon, p.lat] },
        properties: {
          code: p.code,
          state: p.state,
          color: STATE_COLOR[p.state],
          glow: GLOW[p.state],
          label: p.value === null ? p.code : `${p.code}\n${p.value.toFixed(2)} m`,
          auto: p.auto ? 1 : 0,
        },
      })),
    }),
    [points],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!box.current || map.current) return;
      const maplibre = await import("maplibre-gl");
      maplibre.setWorkerUrl(`/vendor/maplibre/${maplibre.getVersion()}/maplibre-gl-worker.mjs`);
      if (cancelled || !box.current) return;
      const m = new maplibre.Map({
        container: box.current,
        style: "https://tiles.openfreemap.org/styles/dark",
        bounds: SERVICE_BOUNDS,
        fitBoundsOptions: { padding: 16 },
        dragRotate: false,
        pitchWithRotate: false,
        attributionControl: { compact: true },
      });
      m.touchZoomRotate.disableRotation();
      m.addControl(new maplibre.NavigationControl({ showCompass: false }), "top-right");
      m.on("error", () => {});
      m.on("load", () => {
        // Water on the dark ground in the brand's teal family, so the rivers read first.
        for (const layer of m.getStyle().layers ?? []) {
          if (/water/i.test(layer.id) && layer.type === "fill")
            m.setPaintProperty(layer.id, "fill-color", "#0d3b4a");
          if (/waterway|river/i.test(layer.id) && layer.type === "line") {
            m.setPaintProperty(layer.id, "line-color", "#2aa7c2");
            m.setPaintProperty(layer.id, "line-opacity", 0.9);
          }
        }
        m.addSource("zones", { type: "geojson", data: zones });
        m.addLayer({
          id: "zones-fill",
          type: "fill",
          source: "zones",
          paint: { "fill-color": "#2f9c95", "fill-opacity": 0.06 },
        });
        m.addLayer({
          id: "zones-glow",
          type: "line",
          source: "zones",
          paint: { "line-color": "#2f9c95", "line-width": 7, "line-opacity": 0.18, "line-blur": 4 },
        });
        m.addLayer({
          id: "zones-line",
          type: "line",
          source: "zones",
          paint: { "line-color": "#5fd1c4", "line-width": 1.4, "line-dasharray": [3, 2] },
        });
        m.addSource("gauges", { type: "geojson", data: features });
        m.addLayer({
          id: "gauges-glow",
          type: "circle",
          source: "gauges",
          paint: {
            "circle-color": ["get", "color"],
            "circle-radius": ["get", "glow"],
            "circle-opacity": 0.28,
            "circle-blur": 0.8,
          },
        });
        m.addLayer({
          id: "gauges-auto",
          type: "circle",
          source: "gauges",
          filter: ["==", ["get", "auto"], 1],
          paint: {
            "circle-radius": 10,
            "circle-color": "rgba(0,0,0,0)",
            "circle-stroke-color": "#e6edf1",
            "circle-stroke-width": 1.2,
            "circle-stroke-opacity": 0.9,
          },
        });
        m.addLayer({
          id: "gauges-dot",
          type: "circle",
          source: "gauges",
          paint: {
            "circle-color": ["get", "color"],
            "circle-radius": 6,
            "circle-stroke-color": "#0f1c26",
            "circle-stroke-width": 2,
          },
        });
        m.addLayer({
          id: "gauges-label",
          type: "symbol",
          source: "gauges",
          layout: {
            "text-field": ["get", "label"],
            "text-font": ["Noto Sans Regular"],
            "text-size": 11,
            "text-offset": [0, 1.3],
            "text-anchor": "top",
            "text-allow-overlap": false,
          },
          paint: { "text-color": "#e6edf1", "text-halo-color": "#0f1c26", "text-halo-width": 1.4 },
        });
        for (const id of ["gauges-dot", "gauges-label", "gauges-glow"]) {
          m.on("click", id, (e) => {
            const code = e.features?.[0]?.properties?.code;
            if (typeof code === "string") setPicked(code);
          });
          m.on("mouseenter", id, () => (m.getCanvas().style.cursor = "pointer"));
          m.on("mouseleave", id, () => (m.getCanvas().style.cursor = ""));
        }
      });
      map.current = m;
    })();
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
    // The map is built once; the data is set below when it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const source = map.current?.getSource("gauges") as GeoJSONSource | undefined;
    source?.setData(features);
  }, [features]);

  const point = points.find((p) => p.code === picked) ?? null;
  return (
    <section className="flex flex-col gap-3" data-signals-map={points.length}>
      <h2 className="text-h3 font-bold text-jaga-ink">{words.title}</h2>
      <p className="text-small text-jaga-text-2">{words.hint}</p>
      <div className="relative overflow-hidden rounded-2xl border border-jaga-line bg-[#0f1c26]">
        <div ref={box} className="h-[70vh] min-h-96 w-full" />
        {point && (
          <aside
            className="absolute inset-x-2 bottom-2 z-10 max-h-[65%] overflow-y-auto rounded-xl border border-[#2f9c95]/60 bg-[#0f1c26]/95 p-4 text-[#e6edf1] shadow-lg backdrop-blur sm:inset-x-auto sm:end-3 sm:top-3 sm:bottom-auto sm:w-80"
            data-signals-map-panel={point.code}
          >
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-bold">
                {point.code} {point.name}
              </h3>
              <button
                type="button"
                onClick={() => setPicked(null)}
                className="min-h-tap min-w-tap rounded-lg border border-[#5fd1c4]/50 px-2 text-small"
              >
                {words.close}
              </button>
            </div>
            <p className="text-small opacity-80">
              {point.zone ? words.zone.replace("{zone}", point.zone) : words.noZone}
            </p>
            <p className="mt-2 flex items-center gap-2 font-bold">
              <span
                aria-hidden="true"
                className="inline-block h-3 w-3 rounded-full"
                style={{ background: STATE_COLOR[point.state] }}
              />
              {words.states[point.state]}
            </p>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-small">
              <dt className="opacity-70">{words.level}</dt>
              <dd>{point.value === null ? words.unknown : `${point.value.toFixed(2)} m`}</dd>
              <dt className="opacity-70">{words.measured}</dt>
              <dd>{point.at ?? words.unknown}</dd>
              <dt className="opacity-70">{words.rise}</dt>
              <dd>
                {point.rise === null
                  ? words.unknown
                  : `${point.rise >= 0 ? "+" : ""}${point.rise.toFixed(2)} m`}
              </dd>
              <dt className="opacity-70">{words.bank}</dt>
              <dd>{point.bank === null ? words.unknown : `${point.bank.toFixed(2)} m`}</dd>
            </dl>
            {point.levels && words.levels && (
              <GaugeLevelsBlock point={point} words={words.levels} action={levelsAction} />
            )}
            <Spark series={point.series} bank={point.bank} levels={point.levels} />
            <p className="mt-2 text-small opacity-80">{words.notIssued}</p>
            {point.canAuto && point.id && (
              <form
                action={action}
                className="mt-3 flex flex-col gap-2 border-t border-[#5fd1c4]/30 pt-3"
                data-signals-auto-form={point.code}
              >
                <input type="hidden" name="station" value={point.id} />
                <input type="hidden" name="view" value="map" />
                <label className="flex min-h-tap items-center gap-3">
                  <input
                    type="checkbox"
                    name="enabled"
                    defaultChecked={point.auto}
                    className="h-6 w-6"
                    key={`${point.code}-${point.auto}`}
                  />
                  <span className="font-bold">{words.autoLabel}</span>
                </label>
                <p className="text-small opacity-80">{words.autoHint}</p>
                {action && (
                  <button
                    type="submit"
                    className="min-h-tap self-start rounded-xl bg-[#2f9c95] px-4 font-bold text-[#0f1c26]"
                  >
                    {words.save}
                  </button>
                )}
              </form>
            )}
          </aside>
        )}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-2 text-small" aria-label={words.title}>
        {(Object.keys(STATE_COLOR) as GaugeState[]).map((s) => (
          <li key={s} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="inline-block h-3 w-3 rounded-full ring-2 ring-[#0f1c26]"
              style={{ background: STATE_COLOR[s] }}
            />
            {words.states[s]} ({points.filter((p) => p.state === s).length})
          </li>
        ))}
        <li className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="inline-block h-3 w-3 rounded-full border border-jaga-edge"
          />
          {words.autoOn} ({points.filter((p) => p.auto).length})
        </li>
      </ul>
    </section>
  );
}

/** Watch, Warning and Evacuate for the picked gauge: where they came from, and a form to change them. */
function GaugeLevelsBlock({
  point,
  words,
  action,
}: {
  point: MapPoint;
  words: NonNullable<MapWords["levels"]>;
  action?: (form: FormData) => void;
}) {
  const lv = point.levels!;
  const shown = [
    ["watch", lv.watch, words.watch, STATE_COLOR.near],
    ["warning", lv.warning, words.warning, STATE_COLOR.warning],
    ["evacuate", lv.evacuate, words.evacuate, STATE_COLOR.evacuate],
  ] as const;
  const fix = (v: number | null) => (v === null ? "" : v.toFixed(2));
  const field =
    "min-h-tap w-full rounded-lg border border-[#5fd1c4]/50 bg-[#0b1620] px-2 text-[#e6edf1]";
  const none = lv.watch === null && lv.warning === null && lv.evacuate === null;
  const origin = none
    ? words.none
    : !lv.provisional
      ? words.set
      : lv.how === "hindcast" || lv.how === "mixed"
        ? `${words.provisional} ${words.fromFloods.replace("{count}", String(lv.floods ?? 0))}`
        : lv.how === "rise"
          ? `${words.provisional} ${words.fromRise}`
          : words.provisional;
  return (
    <div
      className="mt-3 flex flex-col gap-2 border-t border-[#5fd1c4]/30 pt-3"
      data-gauge-levels={point.code}
    >
      <h4 className="font-bold">{words.title}</h4>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-small">
        {shown.map(([key, value, label, color]) => (
          <div key={key} className="contents">
            <dt className="flex items-center gap-2 opacity-80">
              <span
                aria-hidden="true"
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ background: color }}
              />
              {label}
            </dt>
            <dd data-gauge-level={key}>{value === null ? "–" : `${value.toFixed(2)} m`}</dd>
          </div>
        ))}
      </dl>
      <p className="text-small opacity-80">{origin}</p>
      {lv.isKey && <p className="text-small opacity-80">{words.key}</p>}
      {lv.bankSuspect && <p className="text-small font-bold text-[#f2c230]">{words.bankSuspect}</p>}
      {lv.neverReachedBank && <p className="text-small opacity-80">{words.neverReached}</p>}
      {action && point.id && (
        <form action={action} className="flex flex-col gap-2" data-gauge-levels-form={point.code}>
          <input type="hidden" name="station" value={point.id} />
          <input type="hidden" name="view" value="map" />
          <div className="grid grid-cols-3 gap-2">
            {shown.map(([key, value, label]) => (
              <label key={key} className="flex flex-col gap-1 text-small">
                <span className="opacity-80">{label}</span>
                <input
                  name={key}
                  inputMode="decimal"
                  defaultValue={fix(value)}
                  key={`${point.code}-${key}-${fix(value)}`}
                  className={field}
                />
              </label>
            ))}
          </div>
          <label className="flex flex-col gap-1 text-small">
            <span className="opacity-80">{words.note}</span>
            <input name="note" maxLength={300} className={field} />
          </label>
          <p className="text-small opacity-70">{words.hint}</p>
          <button
            type="submit"
            className="min-h-tap self-start rounded-xl bg-[#2f9c95] px-4 font-bold text-[#0f1c26]"
          >
            {words.save}
          </button>
        </form>
      )}
    </div>
  );
}

function Spark({
  series,
  bank,
  levels,
}: {
  series: [number, number][];
  bank: number | null;
  levels?: MapPoint["levels"];
}) {
  if (series.length < 2) return null;
  const marks = (
    [
      [levels?.watch ?? null, STATE_COLOR.near],
      [levels?.warning ?? null, STATE_COLOR.warning],
      [levels?.evacuate ?? bank, STATE_COLOR.evacuate],
    ] as const
  ).filter((m): m is readonly [number, string] => m[0] !== null);
  const xs = series.map((p) => p[0]);
  const ys = [...series.map((p) => p[1]), ...marks.map((m) => m[0])];
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const [y0, y1] = [Math.min(...ys) - 0.1, Math.max(...ys) + 0.1];
  const x = (t: number) => ((t - x0) / Math.max(1, x1 - x0)) * 100;
  const y = (v: number) => 100 - ((v - y0) / (y1 - y0)) * 100;
  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className="mt-2 h-16 w-full"
      aria-hidden="true"
    >
      {marks.map(([v, color]) => (
        <line
          key={`${color}-${v}`}
          x1="0"
          x2="100"
          y1={y(v)}
          y2={y(v)}
          stroke={color}
          strokeWidth="1"
          strokeDasharray="3 2"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      <path
        d={series
          .map(([t, v], i) => `${i ? "L" : "M"}${x(t).toFixed(1)} ${y(v).toFixed(1)}`)
          .join("")}
        fill="none"
        stroke="#5fd1c4"
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
