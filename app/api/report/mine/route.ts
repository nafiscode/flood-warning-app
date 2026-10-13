import { toMyReport, type MyReport } from "@/lib/flood-reports";
import { supabaseConfigured } from "@/lib/supabase/env";
import { NO_STORE } from "@/lib/supabase/public";
import { createClient } from "@/lib/supabase/server";

/**
 * One's own flood reports of the last week and whether each still stands. Private: answered
 * with the caller's own session and never cached.
 */
export async function GET() {
  const answer = (body: unknown, status = 200) =>
    Response.json(body, { status, headers: { "Cache-Control": NO_STORE } });
  if (!supabaseConfigured()) return answer({ error: "unavailable" }, 503);
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims.sub) return answer({ error: "sign_in" }, 401);
  const { data, error } = await supabase.rpc("my_flood_reports");
  if (error || !Array.isArray(data)) return answer({ error: "unavailable" }, 503);
  return answer({
    reports: (data as Record<string, unknown>[])
      .map(toMyReport)
      .filter((r): r is MyReport => r !== null),
  });
}
