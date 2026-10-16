import { toGaugeReading, type GaugeSummary } from "@/lib/map-data";
import { supabaseConfigured } from "@/lib/supabase/env";
import { CACHE_60S, createPublicClient, unavailable } from "@/lib/supabase/public";

/**
 * The river gauges, reduced to what counting them needs: where each one is, what it reads and
 * when it last spoke (the owner, 17 Oct 2026, for "what the monitoring shows now" on the home
 * screen).
 *
 * The home screen must stay usable on slow 3G, so it does not download every station's name,
 * bank level and three-hour trend to be told how its own rivers stand - the map asks for that.
 * Same database read as `/api/public/gauges`, same 60 s at the edge, so the two share the cost.
 *
 * A failure is an error, never an empty list or a set of zeros: "Jaga could not read the rivers"
 * and "every river is below its bank" are opposite facts, and only one of them is true here
 * (safety rule 10).
 */
export async function GET() {
  if (!supabaseConfigured()) return unavailable();
  const { data, error } = await createPublicClient().rpc("station_status");
  if (error || !Array.isArray(data)) return unavailable();
  const body: GaugeSummary = {
    generatedAt: new Date().toISOString(),
    gauges: (data as Record<string, unknown>[]).map(toGaugeReading),
  };
  return Response.json(body, { headers: { "Cache-Control": CACHE_60S } });
}
