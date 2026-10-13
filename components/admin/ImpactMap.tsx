"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import type {
  DataDrivenPropertyValueSpecification,
  FilterSpecification,
  Map as MapLibreMap,
  Marker,
} from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { bubbleSize, percent, provinceCentre, type ProvinceCode } from "@/lib/impact";
import {
  createServiceAreaMap,
  mapInk,
  PROVINCE_BOUNDS,
  SERVICE_BOUNDS,
  TAMBON_LINE_LAYER,
  TAMBON_SOURCE,
} from "@/lib/map";
import motion from "./Impact.module.css";

/**
 * Where the impact record was collected: the four provinces, one circle each (spec 16).
 *
 * **Province is the finest grain on this map, on purpose.** A circle sits in the middle of its
 * province and stands for the whole of it; nothing here is a request, a household or a team's
 * position, and no tambon is shaded by how many requests came from it - a figure that small can
 * point at one house. The one thing drawn per tambon is the list the page already prints in
 * words: the tambons no rescue team covers, which is about the teams' reach and not about
 * anybody who asked for help.
 *
 * The size of a circle is the requests Jaga carried there (by area, so twice the requests is
 * twice the ink); its ring is the share a team confirmed. One teal for all four: the name and
 * the number are written on each circle, so no colour has to say which province it is.
 */

const TINT = "jaga-impact-tint";
const GAPS = "jaga-impact-gaps";
const GAP_LINE = "jaga-impact-gap-line";
const TEAL = "#2f9c95";

export type ImpactMapProvince = {
  province: ProvinceCode;
  name: string;
  requests: number;
  confirmed: number;
  /** What a screen reader hears for this circle. */
  label: string;
};

type Props = {
  provinces: ImpactMapProvince[];
  /** Codes of the tambons no rescue team covers. */
  gaps: string[];
  picked: ProvinceCode | null;
  onPick: (province: ProvinceCode) => void;
  format: (n: number) => string;
  text: { loading: string; failed: string };
};

const among = (list: string[]): FilterSpecification =>
  ["in", ["get", "code"], ["literal", list]] as unknown as FilterSpecification;

/** One province's circle: a real button, so it can be reached and pressed without a pointer. */
function bubble(
  row: ImpactMapProvince,
  max: number,
  format: (n: number) => string,
  step: number,
  largest: number,
) {
  const size = bubbleSize(row.requests, max, largest, Math.round(largest * 0.45));
  const share = percent(row.confirmed, row.requests);
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.impactBubble = row.province;
  button.setAttribute("aria-label", row.label);
  // The circle may be narrower than a thumb on a phone; the button around it never is.
  button.className =
    "group grid min-h-12 min-w-12 cursor-pointer place-items-center border-0 bg-transparent p-0";
  // MapLibre places the button itself with a transform, so the entrance plays inside it.
  const inner = document.createElement("span");
  inner.className = `grid place-items-center ${motion.rise}`;
  inner.style.setProperty("--i", String(step + 2));

  const disc = document.createElement("span");
  disc.className = `relative grid place-items-center rounded-full shadow-md ${motion.ping}`;
  disc.style.width = `${size}px`;
  disc.style.height = `${size}px`;
  disc.style.background = `conic-gradient(var(--jaga-teal-ink) ${share}%, var(--jaga-line) 0)`;

  const face = document.createElement("span");
  face.className =
    "absolute inset-[5px] grid place-items-center rounded-full bg-jaga-surface text-jaga-ink group-aria-pressed:bg-jaga-slate group-aria-pressed:text-white";
  const figure = document.createElement("span");
  // MapLibre's own stylesheet sets 12 px inside the map; the figure is the app's size.
  figure.className =
    size < 56
      ? "text-small font-bold leading-none tabular-nums"
      : "text-body font-bold leading-none tabular-nums";
  figure.textContent = format(row.requests);
  face.append(figure);
  disc.append(face);

  const name = document.createElement("span");
  name.className =
    "mt-1 whitespace-nowrap rounded-full bg-jaga-surface px-2 text-small font-medium text-jaga-ink shadow-sm";
  name.textContent = row.name;

  inner.append(disc, name);
  button.append(inner);
  return button;
}

export function ImpactMap({ provinces, gaps, picked, onPick, format, text }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const markers = useRef<Marker[]>([]);
  const draw = useRef<() => void>(() => {});
  const pick = useRef(onPick);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");

  useEffect(() => {
    pick.current = onPick;
  }, [onPick]);

  // Our own layers: a faint tint over the four provinces, deeper on the one chosen, and the
  // tambons without a rescue team hatched in the map ink (never an alert colour: a missing team
  // is not an alert level).
  useEffect(() => {
    draw.current = () => {
      const m = map.current;
      if (!m) return;
      const ink = mapInk();
      try {
        const above = m.getLayer(TAMBON_LINE_LAYER) ? TAMBON_LINE_LAYER : undefined;
        if (!m.getLayer(TINT)) {
          m.addLayer({ id: TINT, type: "fill", source: TAMBON_SOURCE, paint: {} }, above);
        }
        if (!m.getLayer(GAPS)) {
          m.addLayer({ id: GAPS, type: "fill", source: TAMBON_SOURCE, paint: {} }, above);
        }
        if (!m.getLayer(GAP_LINE)) {
          m.addLayer({
            id: GAP_LINE,
            type: "line",
            source: TAMBON_SOURCE,
            paint: { "line-width": 2, "line-dasharray": [2, 1.5] },
          });
        }
        m.setPaintProperty(TINT, "fill-color", TEAL);
        m.setPaintProperty(
          TINT,
          "fill-opacity",
          (picked
            ? ["case", ["==", ["get", "province_code"], picked], 0.34, 0.1]
            : 0.16) as DataDrivenPropertyValueSpecification<number>,
        );
        m.setPaintProperty(GAPS, "fill-color", ink);
        m.setPaintProperty(GAPS, "fill-opacity", 0.38);
        m.setPaintProperty(GAP_LINE, "line-color", ink);
        m.setFilter(GAPS, among(gaps));
        m.setFilter(GAP_LINE, among(gaps));
      } catch {
        // The style is being replaced: the next "styledata" or "idle" draws again.
      }
    };
    draw.current();
    for (const marker of markers.current) {
      const element = marker.getElement();
      element.setAttribute("aria-pressed", String(element.dataset.impactBubble === picked));
    }
    const m = map.current;
    if (m && state === "ready") {
      const [west, south, east, north] = picked ? PROVINCE_BOUNDS[picked]! : SERVICE_BOUNDS;
      m.fitBounds(
        [
          [west, south],
          [east, north],
        ],
        { padding: picked ? 56 : 8, duration: 600 },
      );
    }
  }, [gaps, picked, state]);

  useEffect(() => {
    if (!container.current) return;
    let cancelled = false;
    Promise.all([createServiceAreaMap(container.current), import("maplibre-gl")])
      .then(([created, maplibre]) => {
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
        created.on("styledata", redraw);
        created.on("idle", redraw);
        const max = provinces.reduce((a, p) => (p.requests > a ? p.requests : a), 0);
        // On a phone the four provinces are about 240 px across: circles sized for a laptop
        // would cover each other and the provinces they stand for.
        const largest = (container.current?.clientWidth ?? 0) < 520 ? 60 : 92;
        markers.current = provinces.map((row, i) => {
          const element = bubble(row, max, format, i, largest);
          element.setAttribute("aria-pressed", "false");
          element.addEventListener("click", (event) => {
            event.stopPropagation();
            pick.current(row.province);
          });
          return new maplibre.Marker({ element, anchor: "center" })
            .setLngLat(provinceCentre(row.province))
            .addTo(created);
        });
      })
      .catch(() => setState("failed"));
    return () => {
      cancelled = true;
      for (const marker of markers.current) marker.remove();
      markers.current = [];
      map.current?.remove();
      map.current = null;
    };
    // The circles are built once, from the season the page was opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (state === "failed") {
    return (
      <p role="alert" className="rounded-xl border border-jaga-line bg-jaga-surface px-4 py-3">
        {text.failed}
      </p>
    );
  }
  return (
    <div className={`relative ${motion.now}`}>
      <div
        ref={container}
        data-impact-map
        data-map-ready={state === "ready"}
        className="h-[52vh] min-h-80 w-full overflow-hidden rounded-xl border border-jaga-line lg:h-[30rem]"
      />
      {state === "loading" && (
        <p className="absolute inset-x-0 top-3 text-center text-small text-jaga-text-2">
          {text.loading}
        </p>
      )}
    </div>
  );
}
