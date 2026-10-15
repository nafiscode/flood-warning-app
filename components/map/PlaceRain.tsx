"use client";

import type { Map as MapLibreMap, Marker } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CLOUD_LOOKS,
  cloudLift,
  dropAt,
  pointsQuery,
  rainClouds,
  rainPoints,
  type PointWeather,
  type RainCloud,
  type RainPlace,
} from "@/lib/place-rain";
import styles from "./PlaceRain.module.css";

/** A class from the module; a missing one is no class rather than "undefined". */
const css = (name: string): string => styles[name] ?? "";

/** As often as the route's edge copy changes: Open-Meteo's "now" moves every 15 minutes. */
const EVERY_MS = 15 * 60_000;

const SVG = "http://www.w3.org/2000/svg";
const CLOUD_PATH = "M12 26h23a8.5 8.5 0 0 0 1-17 11 11 0 0 0-21-2.5A8 8 0 0 0 12 26z";
const BOLT_PATH = "M8 0 1 14h5l-3 12 9-16H7l4-10z";

function svg(className: string, viewBox: string, path: string, fill?: string): SVGSVGElement {
  const root = document.createElementNS(SVG, "svg");
  root.setAttribute("class", className);
  root.setAttribute("viewBox", viewBox);
  root.setAttribute("aria-hidden", "true");
  const shape = document.createElementNS(SVG, "path");
  shape.setAttribute("d", path);
  if (fill) shape.setAttribute("fill", fill);
  root.appendChild(shape);
  return root;
}

/**
 * The cloud for one place, as plain DOM: it lives in a MapLibre marker, outside React's tree.
 * `strike` staggers lightning between places, so two storms never flash in step.
 */
export function cloudElement(cloud: RainCloud, strike = 0): HTMLDivElement {
  const look = CLOUD_LOOKS[cloud.kind];
  const root = document.createElement("div");
  root.className = `${css("cloud")} ${look.dark ? css("dark") : ""}`;
  root.dataset.placeRain = cloud.kind;
  root.dataset.placeRainFor = cloud.id;
  root.setAttribute("aria-hidden", "true");
  root.style.pointerEvents = "none";

  if (look.peek) {
    const peek = document.createElement("span");
    peek.className = `${css("peek")} ${cloud.isDay ? "" : css("moon")}`;
    peek.dataset.peek = cloud.isDay ? "sun" : "moon";
    root.appendChild(peek);
  }

  // The body: a gradient from the top of the cloud to its base, darker for heavy rain.
  const body = svg(css("shape"), "0 0 46 28", CLOUD_PATH);
  const id = `jaga-rain-${cloud.kind}-${cloud.id.replace(/[^A-Za-z0-9_-]/g, "")}`;
  const defs = document.createElementNS(SVG, "defs");
  const gradient = document.createElementNS(SVG, "linearGradient");
  gradient.setAttribute("id", id);
  gradient.setAttribute("x1", "0");
  gradient.setAttribute("y1", "0");
  gradient.setAttribute("x2", "0");
  gradient.setAttribute("y2", "1");
  const stops: [string, string][] = [
    ["0", "var(--body-top)"],
    ["1", "var(--body-bottom)"],
  ];
  for (const [offset, color] of stops) {
    const stop = document.createElementNS(SVG, "stop");
    stop.setAttribute("offset", offset);
    stop.setAttribute("style", `stop-color: ${color}`);
    gradient.appendChild(stop);
  }
  defs.appendChild(gradient);
  body.insertBefore(defs, body.firstChild);
  body.querySelector("path")!.setAttribute("fill", `url(#${id})`);
  root.appendChild(body);

  for (let i = 0; i < look.drops; i++) {
    const { x, delay } = dropAt(i, look.drops, look.fall);
    const drop = document.createElement("span");
    drop.className = [
      css("drop"),
      look.long ? css("long") : "",
      look.slant ? css("slant") : "",
      look.bursts ? css("bursts") : "",
    ].join(" ");
    drop.dataset.drop = "";
    drop.style.insetInlineStart = `${x}%`;
    drop.style.setProperty("--fall", `${look.fall}s`);
    drop.style.setProperty("--delay", `${delay}s`);
    drop.style.setProperty("--rest", `${6 + ((i * 7) % 14)}px`);
    root.appendChild(drop);
  }

  for (let i = 0; i < look.hail; i++) {
    const { x, delay } = dropAt(i, look.hail, 1.1);
    const pellet = document.createElement("span");
    pellet.className = css("pellet");
    pellet.dataset.hail = "";
    pellet.style.insetInlineStart = `${Math.min(80, x + 4)}%`;
    pellet.style.setProperty("--delay", `${delay}s`);
    pellet.style.setProperty("--rest", `${10 + ((i * 5) % 10)}px`);
    root.appendChild(pellet);
  }

  if (look.bolt) {
    const glow = document.createElement("span");
    glow.className = css("glow");
    glow.style.setProperty("--strike", `${strike}s`);
    root.appendChild(glow);
    const bolt = svg(css("bolt"), "0 0 13 26", BOLT_PATH);
    bolt.dataset.bolt = "";
    bolt.style.setProperty("--strike", `${strike}s`);
    root.appendChild(bolt);
  }
  return root;
}

/** What is falling at each place now, asked again every 15 minutes while the page is seen. */
function usePlaceWeather(places: RainPlace[]): PointWeather[] {
  const query = useMemo(() => pointsQuery(rainPoints(places)), [places]);
  const [answer, setAnswer] = useState<{ query: string; points: PointWeather[] } | null>(null);
  useEffect(() => {
    if (query === "") return;
    let cancelled = false;
    const ask = () => {
      if (document.visibilityState === "hidden") return;
      fetch(`/api/public/weather/now?at=${encodeURIComponent(query)}`)
        .then((response) => (response.ok ? response.json() : null))
        .then((body: { points?: PointWeather[] } | null) => {
          if (!cancelled && Array.isArray(body?.points)) setAnswer({ query, points: body.points });
        })
        .catch(() => {
          // No connection: the clouds already drawn stay until the next answer.
        });
    };
    ask();
    const timer = window.setInterval(ask, EVERY_MS);
    document.addEventListener("visibilitychange", ask);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", ask);
    };
  }, [query]);
  return answer && answer.query === query ? answer.points : [];
}

/**
 * Rain clouds over the person's own places on the map (owner, 15 Oct): only where rain is
 * falling now, with lightning in a thunderstorm (lib/place-rain.ts). Shown with the pins and
 * hidden with them. Each cloud is a MapLibre marker, so it follows the pin as the map moves and
 * tilts. With `onCloud` it answers the pointer like the map's other marks (owner, 15 Oct): hover
 * on a laptop and a tap anywhere open a small pop-up, whose button leads to the rain's own
 * section under the map. Without it, it takes no taps.
 */
export function PlaceRain({
  map,
  places,
  onCloud,
}: {
  map: MapLibreMap;
  places: RainPlace[];
  onCloud?: (cloud: RainCloud, how: "hover" | "leave" | "tap") => void;
}) {
  const weather = usePlaceWeather(places);
  // The newest handler, read when the pointer arrives: the clouds are not redrawn for it.
  const handler = useRef(onCloud);
  useEffect(() => {
    handler.current = onCloud;
  }, [onCloud]);
  const answers = onCloud !== undefined;
  const clouds = useMemo(() => rainClouds(places, weather), [places, weather]);
  const key = clouds.map((c) => `${c.id}:${c.kind}:${c.isDay ? 1 : 0}:${c.lat},${c.lon}`).join("|");

  useEffect(() => {
    if (clouds.length === 0) return;
    let markers: Marker[] = [];
    let cancelled = false;
    void import("maplibre-gl").then(({ Marker }) => {
      if (cancelled) return;
      markers = clouds.map((cloud, i) => {
        const element = cloudElement(cloud, (i * 1.7) % 4.6);
        if (answers) {
          element.style.pointerEvents = "auto";
          element.style.cursor = "pointer";
          element.addEventListener("mouseenter", () => handler.current?.(cloud, "hover"));
          element.addEventListener("mouseleave", () => handler.current?.(cloud, "leave"));
          element.addEventListener("click", (event) => {
            // The map underneath must not take the same tap as "nothing here" and close it.
            event.stopPropagation();
            handler.current?.(cloud, "tap");
          });
        }
        return new Marker({
          element,
          anchor: "bottom",
          offset: [0, -cloudLift(cloud.home)],
          // Upright whatever the map's tilt, like a sign held over the place.
          pitchAlignment: "viewport",
          rotationAlignment: "viewport",
        })
          .setLngLat([cloud.lon, cloud.lat])
          .addTo(map);
      });
    });
    return () => {
      cancelled = true;
      for (const marker of markers) marker.remove();
    };
    // `key` stands for the clouds: a new array with the same clouds must not redraw them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key, answers]);

  return null;
}
