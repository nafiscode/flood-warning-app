"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import type { Map as MapLibreMap, Marker } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { createServiceAreaMap } from "@/lib/map";
import { hint } from "@/lib/ui";

type Point = { lat: number; lon: number };

type Props = {
  text: { hint: string; failed: string };
  picked: Point | null;
  onPick: (point: Point) => void;
};

/**
 * A map to tap a place on, for when GPS fails. MapLibre is downloaded only when this opens, so
 * the SOS screen itself stays small on slow 3G; if the map cannot load, the screen falls back to
 * the typed location and the chosen area.
 */
export function PinOnMap({ text, picked, onPick }: Props) {
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const marker = useRef<Marker | null>(null);

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
        created.on("click", (event) => onPick({ lat: event.lngLat.lat, lon: event.lngLat.lng }));
        created.once("load", () => setState("ready"));
      })
      .catch(() => setState("failed"));
    return () => {
      cancelled = true;
      marker.current = null;
      map.current?.remove();
      map.current = null;
    };
    // The callback is stable enough: remounting the map on every render would make it unusable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const current = map.current;
    if (state !== "ready" || !current || !picked) return;
    let cancelled = false;
    if (marker.current) {
      marker.current.setLngLat([picked.lon, picked.lat]);
      return;
    }
    import("maplibre-gl").then(({ Marker: MapMarker }) => {
      if (cancelled || map.current !== current) return;
      marker.current = new MapMarker({ color: "#c62828" })
        .setLngLat([picked.lon, picked.lat])
        .addTo(current);
    });
    return () => {
      cancelled = true;
    };
  }, [picked, state]);

  if (state === "failed") return <p className={hint}>{text.failed}</p>;
  return (
    <>
      <p className={hint}>{text.hint}</p>
      <div
        ref={container}
        data-map-ready={state === "ready"}
        className="h-72 w-full overflow-hidden rounded-xl border border-jaga-line"
      />
    </>
  );
}
