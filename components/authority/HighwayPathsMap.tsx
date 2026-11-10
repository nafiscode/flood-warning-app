"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import type { Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import {
  HAZARD_OPACITY,
  HAZARD_SOURCE_LAYER,
  hazardFillColor,
} from "@/lib/hazard-layer";
import { ALL_CLASSES, CLASS_LOOK, type PathClass } from "@/lib/highway-paths";
import { createServiceAreaMap, mapIsDark, PROVINCE_BOUNDS } from "@/lib/map";
import { buttonSecondary, hint } from "@/lib/ui";

const SECTIONS = "jaga-highway-sections";
const HAZARD = "jaga-highway-hazard";
const HAZARD_FILL = "jaga-highway-hazard-fill";

type Props = {
  province: string;
  /** `pmtiles://` address of the flood-hazard layer, or null when the app has no tile bucket. */
  hazardUrl: string | null;
  /** Every word from the server page; this component holds no copy of its own. */
  text: {
    show: string;
    hide: string;
    legend: string;
    legendNote: string;
    under: string;
    loading: string;
    failed: string;
    classes: Record<PathClass, string>;
  };
};

type MapState = "closed" | "loading" | "ready" | "failed";

/**
 * The flagged sections of one province on a map, over the flood-hazard layer (A19 item 3).
 *
 * Three things are deliberate here:
 *
 *   * **It is closed until asked for.** The list, the figures and the downloads are all server
 *     rendered and work with no map at all - Jaga is built for a cheap phone on slow 3G, and this
 *     page has to be usable before a single tile is fetched.
 *   * **The colours are not alert colours.** `CLASS_LOOK` is violet, measured clear of the alert
 *     palette and of the pink the hazard layer underneath is drawn in, and the legend says in
 *     words that these show the order to check in and not a level (safety rules 2 and 10).
 *   * **The sections come from the API**, which asks the database whether this account may read
 *     that province. Nothing about who may see what is decided in the browser.
 */
export function HighwayPathsMap({ province, hazardUrl, text }: Props) {
  const [state, setState] = useState<MapState>("closed");
  const container = useRef<HTMLDivElement>(null);
  const open = state !== "closed";

  useEffect(() => {
    if (!open || !container.current) return;
    let cancelled = false;
    let map: MapLibreMap | null = null;

    const draw = async (m: MapLibreMap) => {
      const response = await fetch(
        `/api/authority/highway-paths?province=${encodeURIComponent(province)}&format=map`,
      );
      if (!response.ok) throw new Error("no sections");
      const data = await response.json();
      if (cancelled) return;

      // The hazard classes first: they are the ground the sections are drawn on.
      if (hazardUrl && !m.getSource(HAZARD)) {
        m.addSource(HAZARD, { type: "vector", url: hazardUrl });
        m.addLayer({
          id: HAZARD_FILL,
          type: "fill",
          source: HAZARD,
          "source-layer": HAZARD_SOURCE_LAYER,
          paint: {
            "fill-color": hazardFillColor(mapIsDark()) as never,
            "fill-opacity": HAZARD_OPACITY,
            "fill-antialias": false,
          },
        });
      }

      if (!m.getSource(SECTIONS)) m.addSource(SECTIONS, { type: "geojson", data });
      const dark = mapIsDark();
      // One layer per class, thinnest first, so a "look here first" line is never hidden under
      // the grey of a neighbour that carries no sign.
      for (const klass of [...ALL_CLASSES].reverse()) {
        const look = CLASS_LOOK[klass];
        const id = `${SECTIONS}-${klass}`;
        if (m.getLayer(id)) continue;
        m.addLayer({
          id,
          type: "line",
          source: SECTIONS,
          filter: ["==", ["get", "class"], klass],
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": dark ? look.night : look.color,
            "line-width": look.width,
            "line-opacity": klass === "look_first" || klass === "worth_a_look" ? 0.95 : 0.6,
            ...(look.dashed ? { "line-dasharray": [2, 2] } : {}),
          },
        });
      }
      const box = PROVINCE_BOUNDS[province];
      if (box) m.fitBounds(box, { padding: 24, animate: false });
    };

    createServiceAreaMap(container.current)
      .then(async (created) => {
        if (cancelled) {
          created.remove();
          return;
        }
        map = created;
        await new Promise<void>((resolve) => created.once("load", () => resolve()));
        if (cancelled) return;
        await draw(created);
        if (!cancelled) setState("ready");
      })
      .catch(() => {
        if (!cancelled) setState("failed");
      });

    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [open, province, hazardUrl]);

  return (
    <div className="flex flex-col gap-3" data-highway-map-root="true">
      <button
        type="button"
        onClick={() => setState(open ? "closed" : "loading")}
        aria-expanded={open}
        className={buttonSecondary}
        data-highway-map-toggle="true"
      >
        {open ? text.hide : text.show}
      </button>
      {open && state !== "failed" && (
        <>
          <div
            ref={container}
            data-highway-map="true"
            data-map-ready={state === "ready"}
            className="h-96 w-full overflow-hidden rounded-xl border border-jaga-line"
          />
          {state === "loading" && (
            <p role="status" className={hint}>
              {text.loading}
            </p>
          )}
          <div className="flex flex-col gap-2">
            <h3 className="font-medium text-jaga-ink">{text.legend}</h3>
            <ul className="flex flex-col gap-1">
              {ALL_CLASSES.map((klass) => (
                <li key={klass} className="flex items-center gap-2 text-small">
                  <span
                    aria-hidden="true"
                    data-legend-class={klass}
                    className="inline-block h-1 w-8 shrink-0 rounded-full"
                    style={{
                      backgroundColor: CLASS_LOOK[klass].color,
                      height: `${Math.max(2, CLASS_LOOK[klass].width)}px`,
                      opacity: CLASS_LOOK[klass].dashed ? 0.6 : 1,
                    }}
                  />
                  <span>{text.classes[klass]}</span>
                </li>
              ))}
            </ul>
            {/* Said in words, every time: these are not alert levels (safety rules 2 and 10). */}
            <p className={hint} data-highway-legend-note="true">
              {text.legendNote}
            </p>
            {hazardUrl && <p className={hint}>{text.under}</p>}
          </div>
        </>
      )}
      {state === "failed" && (
        <p role="alert" className={hint}>
          {text.failed}
        </p>
      )}
    </div>
  );
}
