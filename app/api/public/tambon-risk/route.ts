import { toTambonRisk } from "@/lib/tambon-risk";
import { supabaseConfigured } from "@/lib/supabase/env";
import { CACHE_1H, createPublicClient, unavailable } from "@/lib/supabase/public";

/**
 * One tambon's share of the flood-risk classes (lib/tambon-risk.ts). Public, the same answer for
 * everyone asking about the same tambon, kept at the edge: the table changes once a season.
 * `risk: null` means the tambon has no row (outside the four provinces).
 */
export async function GET(request: Request) {
  const code = new URL(request.url).searchParams.get("code") ?? "";
  if (!/^\d{6}$/.test(code)) return unavailable(400);
  if (!supabaseConfigured()) return unavailable();
  const { data, error } = await createPublicClient()
    .from("hazard_by_tambon")
    .select(
      "tambon_code, buildings, high_pct, medium_pct, low_pct, minimal_pct, buildings_medium_or_high_pct",
    )
    .eq("tambon_code", code)
    .maybeSingle();
  if (error) return unavailable();
  return Response.json({ risk: toTambonRisk(data) }, { headers: { "Cache-Control": CACHE_1H } });
}
