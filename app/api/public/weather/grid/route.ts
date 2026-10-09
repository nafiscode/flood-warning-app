import type { NextRequest } from "next/server";
import { parseLatLon } from "@/lib/area";
import { unavailable } from "@/lib/supabase/public";
import { USER_AGENT, FORECAST_API } from "@/lib/weather";
import {
  gridFor,
  gridPoints,
  snapCentre,
  GRID_HOURS,
  type WeatherGrid,
} from "@/lib/weather-grid";
import { localToIso } from "@/lib/weather";

/**
 * Rain, temperature, humidity and wind over a square of ground, for the weather maps.
 *
 * One request to Open-Meteo asks for every point of the grid at once (its API takes a list of
 * coordinates), and the answer is cut down to flat arrays of rounded numbers: about 25 kB for
 * 81 points and 24 hours, against 115 kB of what Open-Meteo sends.
 *
 * The centre is snapped to a lattice before anything is asked, so everyone in the same part of
 * the province shares one cached answer and no exact position is in the address.
 */
const CACHE =
  "public, max-age=0, s-maxage=900, stale-while-revalidate=900, stale-if-error=10800";

type RawPoint = {
  utc_offset_seconds?: number;
  timezone?: string;
  hourly?: Record<string, (number | string | null)[] | undefined>;
};

const n1 = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? Math.round(v * 10) / 10 : null;
const n0 = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null;

export async function GET(request: NextRequest) {
  const asked = parseLatLon(
    request.nextUrl.searchParams.get("lat"),
    request.nextUrl.searchParams.get("lon"),
  );
  if (!asked) return unavailable(400);
  // Only the two grids we draw, so the cache holds a handful of answers per area, not thousands.
  const size = gridFor(Number.parseFloat(request.nextUrl.searchParams.get("span") ?? ""));
  const centre = snapCentre(asked.lat, asked.lon, size.span);
  const points = gridPoints(centre, size);

  const query = new URLSearchParams({
    latitude: points.map((p) => p.lat).join(","),
    longitude: points.map((p) => p.lon).join(","),
    hourly:
      "temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,wind_direction_10m",
    timezone: "auto",
    forecast_hours: String(GRID_HOURS),
  });

  let raw: unknown;
  try {
    const response = await fetch(`${FORECAST_API}?${query}`, {
      headers: { "User-Agent": USER_AGENT },
      // A grid is bigger than one forecast, so it is given longer before being given up on.
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    if (!response.ok) return unavailable();
    raw = await response.json();
  } catch {
    return unavailable();
  }

  // One coordinate answers with an object, several with a list; the map always asks for several.
  const list = (Array.isArray(raw) ? raw : [raw]) as RawPoint[];
  if (list.length !== points.length) return unavailable();
  const first = list[0]!;
  const times = (first.hourly?.time ?? []).filter((t): t is string => typeof t === "string");
  if (times.length === 0) return unavailable();
  const offset = typeof first.utc_offset_seconds === "number" ? first.utc_offset_seconds : 0;

  const grid: WeatherGrid = {
    lat: centre.lat,
    lon: centre.lon,
    span: size.span,
    n: size.n,
    step: size.span / (size.n - 1),
    timezone: typeof first.timezone === "string" ? first.timezone : "Asia/Bangkok",
    hours: times.map((t) => localToIso(t, offset)),
    temp: [],
    humidity: [],
    rain: [],
    wind: [],
    windDir: [],
  };

  for (const point of list) {
    const hourly = point.hourly ?? {};
    for (let h = 0; h < times.length; h += 1) {
      grid.temp.push(n1(hourly.temperature_2m?.[h]));
      grid.humidity.push(n0(hourly.relative_humidity_2m?.[h]));
      // Rain is never negative, and a missing hour is not a dry hour: it stays null.
      const rain = n1(hourly.precipitation?.[h]);
      grid.rain.push(rain === null ? null : Math.max(0, rain));
      grid.wind.push(n0(hourly.wind_speed_10m?.[h]));
      grid.windDir.push(n0(hourly.wind_direction_10m?.[h]));
    }
  }

  return Response.json(grid, { headers: { "Cache-Control": CACHE } });
}
