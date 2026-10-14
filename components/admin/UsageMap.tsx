"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import type {
  DataDrivenPropertyValueSpecification,
  GeoJSONSource,
  Map as MapLibreMap,
  Marker,
} from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import {
  createServiceAreaMap,
  mapIsDark,
  SERVICE_BOUNDS,
  TAMBON_LINE_LAYER,
  TAMBON_SOURCE,
} from "@/lib/map";
import type { IpPlace, TambonCount, WatchedTambon } from "@/lib/usage";
import motion from "./Usage.module.css";

/**
 * Where Jaga is used, for the admins (the owner, 14 Oct). Everything on it is a count:
 *
 *  - **Chosen area**: phones per tambon the person picked in the app (the tambon is shaded, light
 *    to dark teal, by how many).
 *  - **Watched & homes**: watched places and saved homes per tambon, as a glowing heat - never a
 *    pin per place (the war room's rule, kept here).
 *  - **Internet location**: the rough city of the internet address, cut to 0.1 degree; a circle
 *    per city, sized by phones. "Everywhere" turns the map into a globe for visitors abroad.
 *  - **Live**: a pulsing figure on each tambon with someone on screen right now.
 *
 * No single phone is ever a mark: every mark is a tambon or a city with its count.
 */

export type UsageLayer = "areas" | "watched" | "ip";
export type UsageView = "area" | "world";

const SRC_WATCHED = "jaga-usage-watched";
const SRC_IP = "jaga-usage-ip";
const L_AREA_FILL = "jaga-usage-area-fill";
const L_HEAT = "jaga-usage-heat";
const L_IP = "jaga-usage-ip-circle";

const point = (lon: number, lat: number, props: Record<string, unknown>) => ({
  type: "Feature" as const,
  geometry: { type: "Point" as const, coordinates: [lon, lat] },
  properties: props,
});

type Props = {
  layer: UsageLayer;
  view: UsageView;
  showLive: boolean;
  areas: TambonCount[];
  watched: WatchedTambon[];
  ip: IpPlace[];
  liveTambons: TambonCount[];
  livePlaces: IpPlace[];
  format: (n: number) => string;
  name: (t: { nameTh: string; nameEn: string }) => string;
  text: { loading: string; failed: string; liveLabel: (place: string, n: string) => string };
};

export function UsageMap(props: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const maplibre = useRef<typeof import("maplibre-gl") | null>(null);
  const markers = useRef<Marker[]>([]);
  const latest = useRef(props);
  const draw = useRef<() => void>(() => {});
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");

  useEffect(() => {
    latest.current = props;
  });

  // Our layers and their data, drawn again after every style change.
  useEffect(() => {
    draw.current = () => {
      const m = map.current;
      if (!m) return;
      const p = latest.current;
      const dark = mapIsDark();
      const teal = dark ? "#7fd1c9" : "#1f7a74";
      try {
        const above = m.getLayer(TAMBON_LINE_LAYER) ? TAMBON_LINE_LAYER : undefined;
        const areaMax = Math.max(1, ...p.areas.map((a) => a.n));
        const watchedMax = Math.max(1, ...p.watched.map((w) => w.places + w.homes));
        const ipMax = Math.max(1, ...p.ip.map((i) => i.n));

        // Chosen area: the tambon itself, shaded by how many phones picked it.
        if (!m.getLayer(L_AREA_FILL)) {
          m.addLayer({ id: L_AREA_FILL, type: "fill", source: TAMBON_SOURCE, paint: {} }, above);
        }
        const steps: unknown[] = ["match", ["get", "code"]];
        for (const a of p.areas) steps.push(a.code, 0.12 + 0.68 * Math.sqrt(a.n / areaMax));
        steps.push(0);
        m.setPaintProperty(L_AREA_FILL, "fill-color", teal);
        m.setPaintProperty(
          L_AREA_FILL,
          "fill-opacity",
          (p.areas.length > 0 ? steps : 0) as DataDrivenPropertyValueSpecification<number>,
        );
        m.setLayoutProperty(L_AREA_FILL, "visibility", p.layer === "areas" ? "visible" : "none");

        // Watched places and homes: a heat, weighted by places + homes per tambon.
        const watchedData = {
          type: "FeatureCollection" as const,
          features: p.watched.map((w) =>
            point(w.lon, w.lat, { w: (w.places + w.homes) / watchedMax }),
          ),
        };
        const ws = m.getSource(SRC_WATCHED) as GeoJSONSource | undefined;
        if (ws) ws.setData(watchedData);
        else m.addSource(SRC_WATCHED, { type: "geojson", data: watchedData });
        if (!m.getLayer(L_HEAT)) {
          m.addLayer({
            id: L_HEAT,
            type: "heatmap",
            source: SRC_WATCHED,
            paint: {
              "heatmap-weight": ["get", "w"],
              "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 6, 18, 10, 46, 13, 80],
              "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 6, 1, 12, 2.5],
              // One hue, light to dark: no alert colour, nothing warm.
              "heatmap-color": [
                "interpolate",
                ["linear"],
                ["heatmap-density"],
                0,
                "rgba(47,156,149,0)",
                0.2,
                "rgba(169,227,220,0.55)",
                0.5,
                "rgba(53,179,170,0.75)",
                0.8,
                "rgba(31,122,116,0.88)",
                1,
                "rgba(18,74,70,0.95)",
              ],
            },
          });
        }
        m.setLayoutProperty(L_HEAT, "visibility", p.layer === "watched" ? "visible" : "none");

        // Internet location: a circle per city, its area by phones.
        const ipData = {
          type: "FeatureCollection" as const,
          features: p.ip.map((i) => point(i.lon, i.lat, { r: Math.sqrt(i.n / ipMax) })),
        };
        const is = m.getSource(SRC_IP) as GeoJSONSource | undefined;
        if (is) is.setData(ipData);
        else m.addSource(SRC_IP, { type: "geojson", data: ipData });
        if (!m.getLayer(L_IP)) {
          m.addLayer({
            id: L_IP,
            type: "circle",
            source: SRC_IP,
            paint: {
              "circle-radius": ["+", 5, ["*", 22, ["get", "r"]]],
              "circle-stroke-width": 2,
            },
          });
        }
        m.setPaintProperty(L_IP, "circle-color", teal);
        m.setPaintProperty(L_IP, "circle-opacity", 0.28);
        m.setPaintProperty(L_IP, "circle-stroke-color", teal);
        m.setLayoutProperty(L_IP, "visibility", p.layer === "ip" ? "visible" : "none");
      } catch {
        // The style is being replaced: the next "styledata" draws again.
      }
    };
    draw.current();
  });

  // The live figures: an HTML mark per tambon (and, on the globe, per city) with someone on now.
  useEffect(() => {
    const m = map.current;
    const ml = maplibre.current;
    for (const marker of markers.current) marker.remove();
    markers.current = [];
    if (!m || !ml || state !== "ready" || !props.showLive) return;
    const lives: { lon: number; lat: number; n: number; label: string }[] = props.liveTambons.map(
      (t) => ({
        lon: t.lon,
        lat: t.lat,
        n: t.n,
        label: props.text.liveLabel(props.name(t), props.format(t.n)),
      }),
    );
    if (props.view === "world") {
      for (const pl of props.livePlaces) {
        lives.push({
          lon: pl.lon,
          lat: pl.lat,
          n: pl.n,
          label: props.text.liveLabel(pl.city ?? pl.country ?? "?", props.format(pl.n)),
        });
      }
    }
    markers.current = lives.map((l, i) => {
      const el = document.createElement("span");
      el.dataset.usageLive = String(l.n);
      el.setAttribute("role", "img");
      el.setAttribute("aria-label", l.label);
      el.title = l.label;
      const size = Math.round(22 + Math.min(18, Math.sqrt(l.n) * 4));
      el.className = `grid place-items-center rounded-full bg-jaga-slate text-[12px] font-bold text-white shadow-md ring-2 ring-jaga-teal-light ${motion.blip}`;
      el.style.width = `${size}px`;
      el.style.height = `${size}px`;
      el.style.setProperty("--delay", `${(i % 6) * 0.3}s`);
      el.textContent = props.format(l.n);
      return new ml.Marker({ element: el, anchor: "center" }).setLngLat([l.lon, l.lat]).addTo(m);
    });
  }, [props, state]);

  // Service area or the whole world (a globe).
  useEffect(() => {
    const m = map.current;
    if (!m || state !== "ready") return;
    try {
      if (props.view === "world") {
        m.setMaxBounds(null);
        m.setProjection({ type: "globe" });
        const pts = props.ip.length > 0 ? props.ip : [];
        const lons = [SERVICE_BOUNDS[0], SERVICE_BOUNDS[2], ...pts.map((p) => p.lon)];
        const lats = [SERVICE_BOUNDS[1], SERVICE_BOUNDS[3], ...pts.map((p) => p.lat)];
        m.fitBounds(
          [
            [Math.min(...lons), Math.min(...lats)],
            [Math.max(...lons), Math.max(...lats)],
          ],
          { padding: 48, maxZoom: 5, duration: 900 },
        );
      } else {
        m.setProjection({ type: "mercator" });
        m.setMaxBounds([
          [SERVICE_BOUNDS[0] - 1.5, SERVICE_BOUNDS[1] - 1.5],
          [SERVICE_BOUNDS[2] + 1.5, SERVICE_BOUNDS[3] + 1.5],
        ]);
        m.fitBounds(
          [
            [SERVICE_BOUNDS[0], SERVICE_BOUNDS[1]],
            [SERVICE_BOUNDS[2], SERVICE_BOUNDS[3]],
          ],
          { padding: 8, duration: 700 },
        );
      }
    } catch {
      // Projection not available in this browser: the flat map stays.
    }
    // Only a change of view moves the map; a refresh of the figures never does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.view, state]);

  useEffect(() => {
    if (!container.current) return;
    let cancelled = false;
    Promise.all([createServiceAreaMap(container.current, "streets"), import("maplibre-gl")])
      .then(([created, ml]) => {
        if (cancelled) {
          created.remove();
          return;
        }
        map.current = created;
        maplibre.current = ml;
        const redraw = () => draw.current();
        created.once("load", () => {
          redraw();
          setState("ready");
        });
        created.on("styledata", redraw);
        created.on("idle", redraw);
      })
      .catch(() => setState("failed"));
    return () => {
      cancelled = true;
      for (const marker of markers.current) marker.remove();
      markers.current = [];
      map.current?.remove();
      map.current = null;
    };
  }, []);

  if (state === "failed") {
    return (
      <p role="alert" className="rounded-xl border border-jaga-line bg-jaga-surface px-4 py-3">
        {props.text.failed}
      </p>
    );
  }
  return (
    <div className="relative">
      <div
        ref={container}
        data-usage-map
        data-map-ready={state === "ready"}
        className="h-[56vh] min-h-80 w-full overflow-hidden rounded-xl border border-jaga-line lg:h-[34rem]"
      />
      {state === "loading" && (
        <p className="absolute inset-x-0 top-3 text-center text-small text-jaga-text-2">
          {props.text.loading}
        </p>
      )}
    </div>
  );
}
