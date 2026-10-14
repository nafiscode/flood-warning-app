import { toSeasonOutlook } from "@/lib/season-outlook";
import { supabaseConfigured } from "@/lib/supabase/env";
import { CACHE_1H, createPublicClient, unavailable } from "@/lib/supabase/public";

/**
 * The seasonal outlook's public line (science plan Module 9). One answer for everyone, kept at the
 * edge for an hour: it changes once a month at most. `outlook: null` means none has been issued.
 */
export async function GET() {
  if (!supabaseConfigured()) return unavailable();
  const { data, error } = await createPublicClient().rpc("public_seasonal_outlook");
  if (error) return unavailable();
  return Response.json({ outlook: toSeasonOutlook(data) }, { headers: { "Cache-Control": CACHE_1H } });
}
