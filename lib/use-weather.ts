"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { areaName, pickName, type Area } from "@/lib/area";
import type { MyPlaces } from "@/lib/me";
import { readStored, useStored, writeStored } from "@/lib/phone-store";
import { roundCoord, type Weather, type WeatherPlace } from "@/lib/weather";

/** The forecast is refreshed every 15 minutes, the same period the edge keeps one answer for. */
const POLL_MS = 15 * 60_000;

/** The chosen place and the last reading, kept on the phone so the chip is there at once. */
const PLACE_KEY = "weather.place";
const READING_KEY = "weather.reading";

type Reading = { key: string; weather: Weather; fetchedAt: number };

export function placeKey(place: { lat: number; lon: number }): string {
  return `${roundCoord(place.lat)},${roundCoord(place.lon)}`;
}

/** The tambon already chosen on the home screen, as a place for the weather. */
export function areaToPlace(area: Area, locale: string): WeatherPlace {
  return {
    name: pickName(locale, area.nameTh, area.nameEn),
    area: pickName(locale, area.provinceTh, area.provinceEn),
    country: null,
    countryCode: "TH",
    lat: area.lat,
    lon: area.lon,
    from: "area",
  };
}

/** The full name of the area behind the short one, for the weather page's heading. */
export function areaPlaceDetail(area: Area, locale: string): string {
  return areaName(locale, area);
}

/**
 * Which place the weather is shown for (owner's choice, 9 Oct 2026): the one the person picked
 * for the weather if there is one, otherwise the home saved in their account or the area already
 * chosen on the home screen, so nobody is asked for their position a second time. Null means no
 * place is known yet; then the weather page asks, and the chip invites a tap.
 */
export function useWeatherPlace(
  me: MyPlaces | null,
  locale: string,
): {
  place: WeatherPlace | null;
  /** Set when the place comes from the home screen's area rather than a weather choice. */
  fromArea: Area | null;
  picked: WeatherPlace | null;
  setPlace: (place: WeatherPlace | null) => void;
} {
  const picked = useStored<WeatherPlace>(PLACE_KEY);
  const area = useStored<Area>("area");
  const home = me?.signedIn && me.home ? me.home : area;
  const fromArea = picked ? null : home;
  const setPlace = useCallback((place: WeatherPlace | null) => writeStored(PLACE_KEY, place), []);
  // One object for as long as the choice behind it is the same: the forecast request below is
  // keyed on it, and a new object on every render would restart it on every render.
  const place = useMemo(
    () => picked ?? (fromArea ? areaToPlace(fromArea, locale) : null),
    [picked, fromArea, locale],
  );
  return { place, fromArea, picked, setPlace };
}

// One request per point even when the chip is on screen twice (phone row and laptop row).
const inflight = new Map<string, Promise<Weather>>();

function load(key: string, lat: number, lon: number): Promise<Weather> {
  const running = inflight.get(key);
  if (running) return running;
  const request = fetch(`/api/public/weather?lat=${roundCoord(lat)}&lon=${roundCoord(lon)}`, {
    cache: "no-store",
  })
    .then((response) => {
      if (!response.ok) throw new Error(String(response.status));
      return response.json() as Promise<Weather>;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, request);
  return request;
}

/** Wait for a quiet moment: the alert status and the SOS button come first on a slow phone. */
function whenIdle(run: () => void): () => void {
  type WithIdle = Window & {
    requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number;
    cancelIdleCallback?: (handle: number) => void;
  };
  const w = window as WithIdle;
  if (w.requestIdleCallback) {
    const handle = w.requestIdleCallback(run, { timeout: 3_000 });
    return () => w.cancelIdleCallback?.(handle);
  }
  const timer = window.setTimeout(run, 1_500);
  return () => window.clearTimeout(timer);
}

/**
 * The forecast for a place. The last answer is kept on the phone, so it shows at once on the
 * next visit and still shows with no connection, always with the time it is from (safety rules
 * 7 and 8). `enabled` is false where a request must not compete with anything that matters:
 * the SOS screens.
 */
export function useWeather(
  place: WeatherPlace | null,
  enabled = true,
): { weather: Weather | null; fetchedAt: number | null; failed: boolean; refresh: () => void } {
  const key = place ? placeKey(place) : null;
  const stored = useStored<Reading>(READING_KEY);
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(() => {
    if (!key || !place) return;
    load(key, place.lat, place.lon).then(
      (weather) => {
        // A place picked meanwhile wins: don't overwrite its reading with this older request.
        const now = readStored<Reading>(READING_KEY);
        if (now && now.key !== key && now.fetchedAt > Date.now() - 1_000) return;
        writeStored(READING_KEY, { key, weather, fetchedAt: Date.now() } satisfies Reading);
        setFailed(false);
      },
      () => setFailed(true),
    );
  }, [key, place]);

  useEffect(() => {
    if (!key || !enabled) return;
    const cancelIdle = whenIdle(refresh);
    const timer = window.setInterval(refresh, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", refresh);
    return () => {
      cancelIdle();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", refresh);
    };
  }, [key, enabled, refresh]);

  const mine = key && stored?.key === key ? stored : null;
  return {
    weather: mine?.weather ?? null,
    fetchedAt: mine?.fetchedAt ?? null,
    failed,
    refresh,
  };
}
