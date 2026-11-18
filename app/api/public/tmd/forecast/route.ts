import type { NextRequest } from "next/server";
import { parseLatLon } from "@/lib/area";
import { unavailable } from "@/lib/supabase/public";
import { forecastUrl, hasToken, toForecast } from "@/lib/tmd-forecast";
import { USER_AGENT } from "@/lib/tmd";

/**
 * The Thai Meteorological Department's own 3 km forecast for a point, as a second opinion beside
 * Open-Meteo (lib/tmd-forecast.ts explains why two).
 *
 * The token stays on the server and never reaches a browser - which is the other reason this goes
 * through our own server, besides the privacy and caching reasons that apply to Open-Meteo too.
 *
 * Without a token this answers 503 like any other unavailable source, and the comparison card is
 * simply not drawn. TMD's limits are 60 requests a minute and 100,000 data points an hour; the
 * point is rounded to about 1 km before it is sent and the answer is cached at the edge for
 * 30 minutes, so the whole service area costs a few dozen requests an hour however many people
 * are reading.
 */
const CACHE =
  "public, max-age=0, s-maxage=1800, stale-while-revalidate=1800, stale-if-error=10800";

export async function GET(request: NextRequest) {
  if (!hasToken()) return unavailable();
  const point = parseLatLon(
    request.nextUrl.searchParams.get("lat"),
    request.nextUrl.searchParams.get("lon"),
  );
  if (!point) return unavailable(400);

  let raw: unknown;
  try {
    const response = await fetch(forecastUrl(point.lat, point.lon), {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
        Authorization: `Bearer ${process.env.TMD_NWP_TOKEN}`,
      },
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });
    // 429 is TMD's rate limit and 401 a token that has stopped working. Both mean "no second
    // opinion for now", which the reader sees as the card not being there.
    if (!response.ok) return unavailable();
    raw = await response.json();
  } catch {
    return unavailable();
  }

  const forecast = toForecast(raw);
  if (!forecast) return unavailable();
  return Response.json(forecast, { headers: { "Cache-Control": CACHE } });
}
