import { createPublicClient, unavailable } from "@/lib/supabase/public";
import { supabaseConfigured } from "@/lib/supabase/env";

/**
 * The "Team coverage" switch on the main map, for everyone: per tambon, whether a verified rescue
 * team has registered to cover it - a yes or a no, from `public_team_coverage()`. No count, no
 * team, no organization, no phone (safety rules 5 and 6). The answer is the same for everyone and
 * changes slowly, so the edge keeps one copy for five minutes.
 *
 * Verified teams and admins read the fuller `/api/geo/coverage` (with their own tambons marked).
 * "Not covered" means no team has registered yet, never that nobody will come (safety rule 10).
 */
const CACHE =
  "public, max-age=0, s-maxage=300, stale-while-revalidate=600, stale-if-error=3600";

export async function GET() {
  if (!supabaseConfigured()) return unavailable();
  const { data, error } = await createPublicClient().rpc("public_team_coverage");
  // A database without the function yet, or one that cannot be reached: no switch, never a
  // map that claims everything is uncovered.
  if (error || !Array.isArray(data)) return unavailable();
  const rows = (data as { tambon: string; province_code: string; covered: boolean }[]).map((r) => ({
    tambon: String(r.tambon),
    province: String(r.province_code ?? ""),
    covered: Boolean(r.covered),
  }));
  return Response.json({ rows }, { headers: { "Cache-Control": CACHE } });
}
