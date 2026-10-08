import type { NextRequest } from "next/server";
import { parseLatLon } from "@/lib/area";
import { toSafePlace, type NearbyPlaces } from "@/lib/places";
import { supabaseConfigured } from "@/lib/supabase/env";
import { CACHE_60S, createPublicClient, unavailable } from "@/lib/supabase/public";

/**
 * The top-3 safe places and the top-3 high-ground car parks from a point (spec 4.3). The app
 * sends the point rounded to about 100 m; nothing is stored.
 */
export async function GET(request: NextRequest) {
  const point = parseLatLon(
    request.nextUrl.searchParams.get("lat"),
    request.nextUrl.searchParams.get("lon"),
  );
  if (!point) return unavailable(400);
  if (!supabaseConfigured()) return unavailable();
  const supabase = createPublicClient();
  const near = (parking: boolean) =>
    supabase.rpc("safe_places_near", {
      p_lat: point.lat,
      p_lon: point.lon,
      p_limit: 3,
      p_parking: parking,
    });
  const [people, parking] = await Promise.all([near(false), near(true)]);
  if (people.error || parking.error) return unavailable();
  const body: NearbyPlaces = {
    people: ((people.data ?? []) as Record<string, unknown>[]).map(toSafePlace),
    parking: ((parking.data ?? []) as Record<string, unknown>[]).map(toSafePlace),
  };
  return Response.json(body, { headers: { "Cache-Control": CACHE_60S } });
}
