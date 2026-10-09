"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import type { MinePlace } from "@/components/map/MapView";
import { useWeatherGrid } from "@/lib/use-weather";
import { GRIDS, type WeatherField } from "@/lib/weather-grid";
import type { WeatherPlace } from "@/lib/weather";
import { WeatherMapCanvas } from "./WeatherMapCanvas";
import { WeatherMapsView } from "./WeatherMapsView";

type Props = { place: WeatherPlace | null; places: MinePlace[] };

/** One hour of the forecast per second and a bit: a band of rain crosses in about half a minute. */
const STEP_MS = 1100;

/** True when the person has asked their phone for less movement. */
function reducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * The live weather maps. Nothing here is loaded until the section is actually scrolled to:
 * the map library and the grid together are the heaviest thing in the app, and most of a page
 * on slow 3G is read without ever reaching them.
 */
export function WeatherMaps({ place, places }: Props) {
  const t = useTranslations("weather");
  const box = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  const [field, setField] = useState<WeatherField>("rain");
  const [hour, setHour] = useState(0);
  const [span, setSpan] = useState<number>(GRIDS[0].span);
  const { grid, state } = useWeatherGrid(place, span, seen);
  /*
   * The hours play by themselves, round and round (the owner, 10 Oct), slowly enough to follow
   * a band of rain across the province. Anyone who has asked for less movement gets it still,
   * and the button starts it; a touch of the slider stops it, so nothing fights the person's
   * hand. It also stops while the page is in the background, where it would only drain a
   * battery for nobody.
   */
  const [playing, setPlaying] = useState(!reducedMotion());
  const hours = grid?.hours.length ?? 0;

  useEffect(() => {
    if (!playing || !seen || hours < 2) return;
    const step = () => {
      if (document.visibilityState !== "visible") return;
      setHour((current) => (current + 1) % hours);
    };
    const timer = window.setInterval(step, STEP_MS);
    return () => window.clearInterval(timer);
  }, [playing, seen, hours]);

  useEffect(() => {
    const element = box.current;
    if (seen) return;
    // Without an observer (an old browser), the map is simply there from the start. The timer
    // keeps that out of the render itself, which is what the effect rules are about.
    if (!element || typeof IntersectionObserver === "undefined") {
      const timer = window.setTimeout(() => setSeen(true), 0);
      return () => window.clearTimeout(timer);
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setSeen(true);
      },
      { rootMargin: "200px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [seen]);

  /** Zoomed out past the grid: ask for the wider, coarser one (and back again). */
  function onViewSpan(view: number) {
    const wanted = view > GRIDS[0].span * 0.9 ? GRIDS[1].span : GRIDS[0].span;
    setSpan((current) => (current === wanted ? current : wanted));
  }

  return (
    <div ref={box}>
      <WeatherMapsView
        grid={grid}
        state={state}
        field={field}
        onField={setField}
        hour={grid ? Math.min(hour, grid.hours.length - 1) : hour}
        onHour={(next) => {
          // A hand on the slider wins: it stops the playback and takes it where it is put.
          setPlaying(false);
          setHour(next);
        }}
        playing={playing}
        onPlaying={setPlaying}
        places={places}
        canvas={
          seen ? (
            <WeatherMapCanvas
              grid={grid}
              field={field}
              hour={grid ? Math.min(hour, grid.hours.length - 1) : hour}
              places={places}
              centre={place ? { lat: place.lat, lon: place.lon } : null}
              onViewSpan={onViewSpan}
              text={{ loading: t("map.loading"), failed: t("map.unavailable") }}
            />
          ) : (
            <div
              aria-hidden="true"
              className="h-[52vh] min-h-72 w-full rounded-xl border border-jaga-line bg-jaga-ground lg:h-full lg:min-h-[460px]"
            />
          )
        }
      />
    </div>
  );
}
