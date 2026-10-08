import type { Hazard } from "@/lib/hazards";
import { supabaseConfigured } from "@/lib/supabase/env";
import { CACHE_1H, createPublicClient, unavailable } from "@/lib/supabase/public";

/** The hazard switcher's list, from the hazards table (spec section 13). Disabled ones are left out. */
export async function GET() {
  if (!supabaseConfigured()) return unavailable();
  const { data, error } = await createPublicClient()
    .from("hazards")
    .select("code, status, name, description, placeholder, hotline")
    .neq("status", "disabled")
    .order("display_order");
  if (error || !data) return unavailable();
  return Response.json({ hazards: data as Hazard[] }, { headers: { "Cache-Control": CACHE_1H } });
}
