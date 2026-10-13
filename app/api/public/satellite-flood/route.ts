import {
  SATELLITE_DEFAULT,
  SATELLITE_MAX_CELLS,
  SATELLITE_PROVINCES,
  isSatelliteWindow,
  satelliteLayer,
  toSatelliteFlood,
  type SatelliteWindow,
} from "@/lib/satellite-flood";
import { unavailable } from "@/lib/supabase/public";

/**
 * Flood seen by satellite in the last 3, 7 or 30 days in the four provinces, from GISTDA's open
 * service. One address per window for everyone, kept at the edge for half an hour: the phone
 * asks Jaga, never GISTDA, so the key stays here and a slow answer from them holds up nobody's
 * map (the layer is asked for only when someone switches it on).
 *
 * Whatever goes wrong - no key, a refusal, a timeout - the answer is "unavailable", never an
 * empty map: an empty map would read as "no flood" (safety rule 10). GISTDA's answers repeat the
 * key inside `links`; only the slimmed features leave this function, and errors carry no detail.
 */
export const maxDuration = 60;

const BASE = "https://api-gateway.gistda.or.th/api/2.0/resources/features";
const PAGE = 5000;
const CACHE = "public, max-age=0, s-maxage=1800, stale-while-revalidate=1800, stale-if-error=3600";

async function province(
  key: string,
  days: SatelliteWindow,
  code: string,
): Promise<{ features: unknown[]; more: boolean }> {
  const features: unknown[] = [];
  for (let offset = 0; offset < SATELLITE_MAX_CELLS; offset += PAGE) {
    const response = await fetch(
      `${BASE}/${satelliteLayer(days)}?pv_idn=${code}&limit=${PAGE}&offset=${offset}`,
      {
        headers: { "API-Key": key, accept: "application/json" },
        signal: AbortSignal.timeout(25_000),
        cache: "no-store",
      },
    );
    if (!response.ok) throw new Error("gistda");
    const body = (await response.json()) as { features?: unknown[]; numberMatched?: number };
    const page = Array.isArray(body.features) ? body.features : [];
    features.push(...page);
    const matched = Number(body.numberMatched);
    if (page.length < PAGE || (Number.isFinite(matched) && features.length >= matched)) {
      return { features, more: false };
    }
  }
  return { features, more: true };
}

export async function GET(request: Request) {
  const asked = new URL(request.url).searchParams.get("days") ?? String(SATELLITE_DEFAULT);
  if (!isSatelliteWindow(asked)) return unavailable(400);
  const days = Number(asked) as SatelliteWindow;
  const key = (process.env.GISTDA_API_KEY ?? "").trim();
  if (!key) return unavailable();
  try {
    const parts = await Promise.all(SATELLITE_PROVINCES.map((code) => province(key, days, code)));
    const body = toSatelliteFlood(
      parts.flatMap((p) => p.features),
      days,
      new Date().toISOString(),
      parts.some((p) => p.more),
    );
    return Response.json(body, { headers: { "Cache-Control": CACHE } });
  } catch {
    return unavailable(502);
  }
}
