"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import type { Map as MapLibreMap, Marker } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import type { Located } from "@/lib/area";
import { createServiceAreaMap } from "@/lib/map";
import { buttonSecondary, hint } from "@/lib/ui";
import { PlaceFinder, type FinderText } from "./PlaceFinder";

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
  /**
   * The words of the "find the place" box. With them the field also offers a search by name and
   * takes pasted coordinates and shared links (the owner's request, 12 Oct), and says in words
   * which tambon the pin is in. Without them it is the GPS button and the map, as before.
   */
  finder?: FinderText;
  locale?: string;
};

type Point = { lat: number; lon: number };
type State = "idle" | "locating" | "failed";
type MapState = "closed" | "loading" | "ready" | "failed";
/** Which tambon a point is in, remembered with the point it was asked for. */
type Where = { key: string; located: Located | null };

const keyOf = (point: Point) => `${point.lat.toFixed(5)},${point.lon.toFixed(5)}`;

/** "ต.บานา อ.เมืองปัตตานี จ.ปัตตานี": a pin said in words, which numbers never are to most people. */
function areaName(located: Located, locale: string): string {
  if (located.kind !== "tambon") return "";
  const area = located.area;
  return locale === "en"
    ? `${area.nameEn}, ${area.districtEn}, ${area.provinceEn}`
    : `ต.${area.nameTh} อ.${area.districtTh} จ.${area.provinceTh}`;
}

/**
 * Home location: from the phone's GPS, or a pin placed on the map (when GPS fails or the person
 * is setting it up away from home). Optional: the form saves without it. The coordinates go into
 * hidden fields; the server works out the tambon, never the browser.
 */
export function HomeLocationField({ text, initial = null, finder, locale = "th" }: Props) {
  const [point, setPoint] = useState<Point | null>(initial);
  const [state, setState] = useState<State>("idle");
  const [mapState, setMapState] = useState<MapState>("closed");
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const marker = useRef<Marker | null>(null);
  // Set when the point came from the box: the map then goes there and zooms in, wherever it was.
  const goThere = useRef(false);
  const [where, setWhere] = useState<Where | null>(null);
  const open = mapState !== "closed";

  /** A point from the box: pin it, and show it on the map so it can be put right by hand. */
  function pick(next: Point) {
    goThere.current = true;
    setPoint(next);
    setState("idle");
    if (mapState === "closed" || mapState === "failed") setMapState("loading");
  }

  // The pin in words. Asked a moment after the pin settles, so dragging a finger across the map
  // does not ask for every place on the way; the position is not stored by the answer.
  useEffect(() => {
    if (!finder || !point) return;
    const key = keyOf(point);
    let cancelled = false;
    const timer = window.setTimeout(() => {
      fetch(`/api/geo/locate?lat=${point.lat.toFixed(5)}&lon=${point.lon.toFixed(5)}`)
        .then((response) => (response.ok ? (response.json() as Promise<Located>) : null))
        .then(
          (located) => {
            if (!cancelled) setWhere({ key, located });
          },
          () => {
            if (!cancelled) setWhere({ key, located: null });
          },
        );
    }, 500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [finder, point]);

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
    // From the box the map always goes to the place and close enough to see the houses; from a
    // tap or the GPS it only moves when the pin would otherwise be off the screen.
    const show = () => {
      const asked = goThere.current;
      goThere.current = false;
      if (asked) {
        current.flyTo({ center: [point.lon, point.lat], zoom: Math.max(current.getZoom(), 15) });
      } else if (!current.getBounds().contains([point.lon, point.lat])) {
        current.flyTo({ center: [point.lon, point.lat], zoom: 14 });
      }
    };
    if (marker.current) {
      marker.current.setLngLat([point.lon, point.lat]);
      show();
      return;
    }
    import("maplibre-gl").then(({ Marker: MapMarker }) => {
      if (cancelled || map.current !== current) return;
      marker.current = new MapMarker({ color: "#1d3b53" })
        .setLngLat([point.lon, point.lat])
        .addTo(current);
      show();
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
      {finder && (
        <PlaceFinder
          text={finder}
          locale={locale}
          near={() => {
            const centre = map.current?.getCenter();
            return centre ? { lat: centre.lat, lon: centre.lng } : point;
          }}
          onPick={pick}
        />
      )}
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
      {finder && point && where?.key === keyOf(point) && where.located && (
        <p className="font-medium" data-pin-area={where.located.kind}>
          {where.located.kind === "tambon" && `${finder.inArea} ${areaName(where.located, locale)}`}
          {where.located.kind === "notCovered" && finder.notCovered}
          {where.located.kind === "outside" && finder.outside}
        </p>
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
