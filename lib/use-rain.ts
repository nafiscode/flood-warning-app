"use client";

import { useLocale } from "next-intl";
import { useMyPlaces } from "@/lib/use-public";
import { useWeather, useWeatherPlace } from "@/lib/use-weather";
import { weatherGroup, type Weather, type WeatherPlace } from "@/lib/weather";
import type { Feed, RainReading } from "@/lib/monitoring";

/**
 * The forecast model's rain for the person's own place, from the reading this device already
 * keeps - and **nothing is asked for here**.
 *
 * The weather chip in the header is on every page and keeps that reading fresh, so the monitoring
 * section rides along for no bytes at all, which is what lets it onto a home screen with a slow
 * 3G budget (CLAUDE.md). `enabled: false` is what says "read, never fetch".
 *
 * Before the chip has ever answered there is simply no reading, and the section says so rather
 * than saying it is dry (safety rule 10).
 */
export function useKeptRain(): Feed<RainReading> & {
  place: WeatherPlace | null;
  /** The whole kept reading, for the hour-by-hour rain chart in the opened detail. */
  weather: Weather | null;
} {
  const locale = useLocale();
  const me = useMyPlaces();
  const { place } = useWeatherPlace(me, locale);
  const { weather, failed } = useWeather(place, false);
  if (!place) return { state: "loading", data: null, place: null, weather: null };
  if (weather) {
    return {
      state: "ok",
      data: { group: weatherGroup(weather.code), rainMm: weather.rainMm, at: weather.at },
      place,
      weather,
    };
  }
  return { state: failed ? "unavailable" : "loading", data: null, place, weather: null };
}
