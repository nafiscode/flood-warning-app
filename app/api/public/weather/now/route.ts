import type { NextRequest } from "next/server";
import { nowUrl, readPointsQuery, toPointWeather } from "@/lib/place-rain";
import { unavailable } from "@/lib/supabase/public";
import { USER_AGENT } from "@/lib/weather";

/**
 * The weather falling right now at a few points: the person's home and watched places, for the
 * rain clouds over their pins on the map (lib/place-rain.ts). One Open-Meteo request for all of
 * them (free for non-commercial use, no key).
 *
 * Through our server for the same reasons as /api/public/weather: no phone's address or exact
 * position reaches a third party (the points are rounded to about a kilometre before they leave
 * the phone), and the edge keeps one answer for 15 minutes. Nothing is written down.
 */
const CACHE =
  "public, max-age=0, s-maxage=900, stale-while-revalidate=900, stale-if-error=3600";

export async function GET(request: NextRequest) {
  const points = readPointsQuery(request.nextUrl.searchParams.get("at"));
  if (points.length === 0) return unavailable(400);

  let raw: unknown;
  try {
    const response = await fetch(nowUrl(points), {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });
    if (!response.ok) return unavailable();
    raw = await response.json();
  } catch {
    // No answer: the map simply draws no clouds, as if nothing were falling.
    return unavailable();
  }
  return Response.json(
    { points: toPointWeather(points, raw) },
    { headers: { "Cache-Control": CACHE } },
  );
}
