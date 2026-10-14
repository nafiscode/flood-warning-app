import { toGauge, type GaugeData } from "@/lib/map-data";
import { supabaseConfigured } from "@/lib/supabase/env";
import { CACHE_60S, createPublicClient, unavailable } from "@/lib/supabase/public";

/**
 * The river gauges alone (A8 item 4), for the map to ask again every few minutes while it is
 * open. The database fetches a new reading every 15 minutes; this answer is the same for everyone
 * and kept at the edge for 60 s, so polling costs one small database read a minute at most.
 */
export async function GET() {
  if (!supabaseConfigured()) return unavailable();
  const { data, error } = await createPublicClient().rpc("station_status");
  if (error) return unavailable();
  const body: GaugeData = {
    gauges: ((data ?? []) as Record<string, unknown>[]).map(toGauge),
  };
  return Response.json(body, { headers: { "Cache-Control": CACHE_60S } });
}
