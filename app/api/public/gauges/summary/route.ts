import { worthNaming } from "@/lib/map-console";
import { toGaugeReading, type GaugeSummary } from "@/lib/map-data";
import { supabaseConfigured } from "@/lib/supabase/env";
import { CACHE_60S, createPublicClient, unavailable } from "@/lib/supabase/public";

/**
 * The river gauges, reduced to what counting them needs: where each one is, what it reads and
 * when it last spoke (the owner, 17 Oct 2026, for "what the monitoring shows now" on the home
 * screen).
 *
 * The home screen must stay usable on slow 3G, so it does not download every station's name or
 * bank level to be told how its own rivers stand - the map asks for that. It does now carry each
 * station's two trends (18 Nov 2026), because "the river near you is rising" is the earliest
 * sentence this app can honestly say and two numbers a station is a few hundred bytes; and the
 * name of a station the screen may have to name, which is only ever a handful of them (19 Nov).
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
    /*
     * A station at or near its bank, or one that has risen in the last three hours, also carries
     * its id and its name, so the home screen can say which rivers it means (the owner, 19 Nov
     * 2026). Every other station stays as it was: a point, a reading and two trends.
     */
    gauges: (data as Record<string, unknown>[]).map((row) => {
      const reading = toGaugeReading(row);
      return worthNaming(reading) ? toGaugeReading(row, true) : reading;
    }),
  };
  return Response.json(body, { headers: { "Cache-Control": CACHE_60S } });
}
