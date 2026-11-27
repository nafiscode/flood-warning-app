import { createPublicClient, unavailable } from "@/lib/supabase/public";
import { supabaseConfigured } from "@/lib/supabase/env";
import { toSosPulseRows } from "@/lib/sos-pulse";

/**
 * Where a request for rescue is waiting and no team has taken it, for everyone looking at the map
 * (owner, 27 Nov 2026). One row per tambon from `public_unanswered_sos()`: a count and how long
 * the oldest has waited. No point, no phone, no sender, no case (safety rule 6); the exact place
 * and the number go to teams and admins only (safety rule 5).
 *
 * Kept at the edge for 30 seconds and no longer: this is the one public answer where a stale copy
 * costs time. A database that cannot be reached, or one without the function yet, gives no answer
 * at all, never an empty list that reads as "nobody is waiting" (safety rule 10).
 */
const CACHE = "public, max-age=0, s-maxage=30, stale-while-revalidate=30, stale-if-error=300";

export async function GET() {
  if (!supabaseConfigured()) return unavailable();
  const { data, error } = await createPublicClient().rpc("public_unanswered_sos");
  if (error || !Array.isArray(data)) return unavailable();
  return Response.json(
    { rows: toSosPulseRows(data as Record<string, unknown>[]), asOf: new Date().toISOString() },
    { headers: { "Cache-Control": CACHE } },
  );
}
