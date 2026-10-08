import type { NextRequest } from "next/server";
import { parseLatLon } from "@/lib/area";
import { unavailable } from "@/lib/supabase/public";
import { forecastUrl, toWeather, USER_AGENT } from "@/lib/weather";

/**
 * The weather forecast for a point, from Open-Meteo (free for non-commercial use, no key).
 *
 * The request goes through our server on purpose: the phone's IP address and position never
 * reach a third party, and the answer for a rounded point (about 1 km) is the same for everyone,
 * so Vercel's edge serves one copy for 15 minutes instead of calling Open-Meteo per visitor.
 * Nothing here is personal and nothing is written down.
 */
const CACHE =
  "public, max-age=0, s-maxage=900, stale-while-revalidate=900, stale-if-error=10800";

export async function GET(request: NextRequest) {
  const point = parseLatLon(
    request.nextUrl.searchParams.get("lat"),
    request.nextUrl.searchParams.get("lon"),
  );
  if (!point) return unavailable(400);

  let raw: unknown;
  try {
    const response = await fetch(forecastUrl(point.lat, point.lon), {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });
    if (!response.ok) return unavailable();
    raw = await response.json();
  } catch {
    // Open-Meteo down, slow or rate-limiting us: the phone keeps showing its last reading.
    return unavailable();
  }

  const weather = toWeather(raw as Parameters<typeof toWeather>[0]);
  if (!weather) return unavailable();
  return Response.json(weather, { headers: { "Cache-Control": CACHE } });
}
