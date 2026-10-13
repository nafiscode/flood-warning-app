import {
  toTambonReports,
  type ReportsNear,
  type TambonReports,
} from "@/lib/flood-reports";
import { supabaseConfigured } from "@/lib/supabase/env";
import { CACHE_60S, createPublicClient, unavailable } from "@/lib/supabase/public";

/**
 * The tambons with a standing flood report from residents: one address and one answer for
 * everyone, kept at the edge for 60 s. Counts per tambon only (safety rule 6); each phone picks
 * out its own district by itself, so nobody's area is sent anywhere to ask.
 * A failure is an error, never an empty list: "no reports" must not be shown by mistake.
 */
export async function GET() {
  if (!supabaseConfigured()) return unavailable();
  const { data, error } = await createPublicClient().rpc("flood_reports_by_tambon");
  if (error || !Array.isArray(data)) return unavailable();
  const body: ReportsNear = {
    generatedAt: new Date().toISOString(),
    tambons: (data as Record<string, unknown>[])
      .map(toTambonReports)
      .filter((r): r is TambonReports => r !== null),
  };
  return Response.json(body, { headers: { "Cache-Control": CACHE_60S } });
}
