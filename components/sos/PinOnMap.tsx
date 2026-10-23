"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import type { Map as MapLibreMap, Marker } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { LocationFinder, type FoundLocation } from "@/components/home/LocationFinder";
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
 *
 * Above the map is a box for the exact position (the owner, 23 Oct 2026): paste the latitude and
 * longitude copied from a map, or type a tambon name. A pasted point is passed on exactly as it
 * is and the map goes there, so it can still be nudged by hand; a tambon name puts the pin in the
 * middle of it and shows all of it, and the person taps the spot. The box works with no map and no
 * signal for coordinates, and it is never a step: the tap on the map and everything else on the
 * screen are as they were.
 */
export function PinOnMap({ text, picked, onPick }: Props) {
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const marker = useRef<Marker | null>(null);
  // Where the box sent the map, kept until the map is ready to go there.
  const goTo = useRef<{ point: Point; zoom: number } | null>(null);

  function fly() {
    const current = map.current;
    const target = goTo.current;
    if (!current || !target) return;
    goTo.current = null;
    current.flyTo({
      center: [target.point.lon, target.point.lat],
      zoom: Math.max(current.getZoom(), target.zoom),
    });
  }

  function found({ point, area }: FoundLocation) {
    // A tambon is a district-sized place: the map shows all of it so the spot can be tapped, as
    // after the list of areas below. A pasted point is exact: close enough to see the houses.
    goTo.current = { point, zoom: area ? 13 : 16 };
    onPick(point);
    fly();
  }

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
        created.once("load", () => {
          setState("ready");
          fly();
        });
      })
      .catch(() => setState("failed"));
    return () => {
      cancelled = true;
      marker.current = null;
      map.current?.remove();
      map.current = null;
    };
    // The callbacks are stable enough: remounting the map on every render would make it unusable.
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

  // The box still works without the map: a pasted position is a position.
  if (state === "failed") {
    return (
      <>
        <LocationFinder onFound={found} />
        <p className={hint}>{text.failed}</p>
      </>
    );
  }
  return (
    <>
      <LocationFinder onFound={found} />
      <p className={hint}>{text.hint}</p>
      <div
        ref={container}
        data-map-ready={state === "ready"}
        className="h-72 w-full overflow-hidden rounded-xl border border-jaga-line"
      />
    </>
  );
}
