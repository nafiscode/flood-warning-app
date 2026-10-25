import { toGauge, withSea, type GaugeData } from "@/lib/map-data";
import { supabaseConfigured } from "@/lib/supabase/env";
import { CACHE_60S, createPublicClient, unavailable } from "@/lib/supabase/public";

/**
 * The river gauges alone (A8 item 4), for the map to ask again every few minutes while it is
 * open. The database fetches a new reading every 15 minutes; this answer is the same for everyone
 * and kept at the edge for 60 s, so polling costs one small database read a minute at most.
 */
export async function GET() {
  if (!supabaseConfigured()) return unavailable();
  const supabase = createPublicClient();
  const [{ data, error }, sea] = await Promise.all([
    supabase.rpc("station_status"),
    supabase.rpc("gauge_sea_gate"),
  ]);
  if (error) return unavailable();
  // The sea beside the river is extra: if it cannot be read the gauges still go out without it.
  const body: GaugeData = {
    gauges: withSea(((data ?? []) as Record<string, unknown>[]).map(toGauge), sea.error ? null : sea.data),
  };
  return Response.json(body, { headers: { "Cache-Control": CACHE_60S } });
}
