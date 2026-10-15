import { unavailable } from "@/lib/supabase/public";
import { marineUrl, SEA_USER_AGENT, toSea, windUrl } from "@/lib/sea";

/**
 * Waves, swell, sea level, wind and thunder at seven points off the coast (lib/sea.ts), from
 * Open-Meteo's marine and weather models (free for non-commercial use, no key). Two requests,
 * one per model, each for all seven points. The answer is the same for everyone, so the edge
 * keeps one copy for half an hour; the models themselves update every few hours.
 */
const CACHE =
  "public, max-age=0, s-maxage=1800, stale-while-revalidate=1800, stale-if-error=21600";

async function ask(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { "User-Agent": SEA_USER_AGENT },
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(String(response.status));
  return response.json();
}

export async function GET() {
  let marine: unknown;
  let wind: unknown;
  try {
    [marine, wind] = await Promise.all([ask(marineUrl()), ask(windUrl())]);
  } catch {
    // Open-Meteo down or slow: the card says there is no sea forecast, never that it is calm.
    return unavailable();
  }
  const sea = toSea(marine, wind, Date.now());
  if (!sea) return unavailable();
  return Response.json(sea, { headers: { "Cache-Control": CACHE } });
}
