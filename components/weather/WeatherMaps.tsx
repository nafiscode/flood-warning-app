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
        onHour={setHour}
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
