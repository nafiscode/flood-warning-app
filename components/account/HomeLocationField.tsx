"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import type { Map as MapLibreMap, Marker } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { createServiceAreaMap } from "@/lib/map";
import { buttonSecondary, hint } from "@/lib/ui";

type Props = {
  /** Text comes from the server page, so no messages are shipped to the browser for this. */
  text: {
    useGps: string;
    locating: string;
    found: string;
    failed: string;
    clear: string;
    useMap: string;
    hideMap: string;
    mapHint: string;
    mapFailed: string;
  };
  initial?: { lat: number; lon: number } | null;
};

type Point = { lat: number; lon: number };
type State = "idle" | "locating" | "failed";
type MapState = "closed" | "loading" | "ready" | "failed";

/**
 * Home location: from the phone's GPS, or a pin placed on the map (when GPS fails or the person
 * is setting it up away from home). Optional: the form saves without it. The coordinates go into
 * hidden fields; the server works out the tambon, never the browser.
 */
export function HomeLocationField({ text, initial = null }: Props) {
  const [point, setPoint] = useState<Point | null>(initial);
  const [state, setState] = useState<State>("idle");
  const [mapState, setMapState] = useState<MapState>("closed");
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const marker = useRef<Marker | null>(null);
  const open = mapState !== "closed";

  function locate() {
    if (!("geolocation" in navigator)) {
      setState("failed");
      return;
    }
    setState("locating");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setPoint({ lat: position.coords.latitude, lon: position.coords.longitude });
        setState("idle");
      },
      () => setState("failed"),
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 60_000 },
    );
  }

  // The map exists only while it is open; MapLibre is downloaded on the first open.
  useEffect(() => {
    if (!open || !container.current) return;
    let cancelled = false;
    createServiceAreaMap(container.current)
      .then((created) => {
        if (cancelled) {
          created.remove();
          return;
        }
        map.current = created;
        created.on("click", (event) => {
          setPoint({ lat: event.lngLat.lat, lon: event.lngLat.lng });
          setState("idle");
        });
        created.once("load", () => setMapState("ready"));
      })
      .catch(() => setMapState("failed"));
    return () => {
      cancelled = true;
      marker.current = null;
      map.current?.remove();
      map.current = null;
    };
  }, [open]);

  // Keep the pin on the chosen point, wherever it came from (GPS or a tap).
  useEffect(() => {
    const current = map.current;
    if (mapState !== "ready" || !current) return;
    let cancelled = false;
    if (!point) {
      marker.current?.remove();
      marker.current = null;
      return;
    }
    if (marker.current) {
      marker.current.setLngLat([point.lon, point.lat]);
      return;
    }
    import("maplibre-gl").then(({ Marker: MapMarker }) => {
      if (cancelled || map.current !== current) return;
      marker.current = new MapMarker({ color: "#1d3b53" })
        .setLngLat([point.lon, point.lat])
        .addTo(current);
      if (!current.getBounds().contains([point.lon, point.lat])) {
        current.flyTo({ center: [point.lon, point.lat], zoom: 14 });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [point, mapState]);

  return (
    <div className="flex flex-col gap-3">
      <input type="hidden" name="lat" value={point ? point.lat.toFixed(6) : ""} />
      <input type="hidden" name="lon" value={point ? point.lon.toFixed(6) : ""} />
      <button
        type="button"
        onClick={locate}
        disabled={state === "locating"}
        className={buttonSecondary}
      >
        {state === "locating" ? text.locating : text.useGps}
      </button>
      <button
        type="button"
        onClick={() => setMapState(open ? "closed" : "loading")}
        aria-expanded={open}
        className={buttonSecondary}
      >
        {open ? text.hideMap : text.useMap}
      </button>
      {open && mapState !== "failed" && (
        <>
          <p className={hint}>{text.mapHint}</p>
          <div
            ref={container}
            data-map-ready={mapState === "ready"}
            className="h-80 w-full overflow-hidden rounded-xl border border-jaga-line"
          />
        </>
      )}
      <p role="status" className={hint}>
        {mapState === "failed" && text.mapFailed}
        {mapState !== "failed" && state === "failed" && text.failed}
        {mapState !== "failed" &&
          state !== "failed" &&
          point &&
          `${text.found} ${point.lat.toFixed(5)}, ${point.lon.toFixed(5)}`}
      </p>
      {point && (
        <button
          type="button"
          onClick={() => setPoint(null)}
          className="min-h-tap self-start underline"
        >
          {text.clear}
        </button>
      )}
    </div>
  );
}
