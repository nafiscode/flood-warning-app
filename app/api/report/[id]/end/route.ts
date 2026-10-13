import { supabaseConfigured } from "@/lib/supabase/env";
import { NO_STORE } from "@/lib/supabase/public";
import { createClient } from "@/lib/supabase/server";

/**
 * "The water has gone, it is safe to travel": the reporter ends their own flood report, so it
 * stops counting for the neighbours (the owner, 13 Oct). Only one's own report can be ended;
 * the database function checks that, not this route.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(_request: Request, context: RouteContext<"/api/report/[id]/end">) {
  const { id } = await context.params;
  const answer = (body: unknown, status = 200) =>
    Response.json(body, { status, headers: { "Cache-Control": NO_STORE } });
  if (!UUID.test(id)) return answer({ error: "not_found" }, 404);
  if (!supabaseConfigured()) return answer({ error: "unavailable" }, 503);
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims.sub) return answer({ error: "sign_in" }, 401);
  const { data, error } = await supabase.rpc("end_my_flood_report", { p_report: id });
  if (error) return answer({ error: "unavailable" }, 503);
  if (data !== true) return answer({ error: "not_yours" }, 403);
  return answer({ ok: true });
}
