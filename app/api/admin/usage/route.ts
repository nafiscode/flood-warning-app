import { readUsage } from "@/lib/admin-usage";
import { getSessionProfile, isAdminRole } from "@/lib/auth";
import { supabaseConfigured } from "@/lib/supabase/env";
import { NO_STORE } from "@/lib/supabase/public";
import { readWindow } from "@/lib/usage";

/**
 * The usage dashboard's own refresh, every 30 seconds while an admin has it open. Read with the
 * admin's own session, so the database decides; the check here only saves a pointless round trip.
 */
export async function GET(request: Request) {
  const answer = (body: unknown, status = 200) =>
    Response.json(body, { status, headers: { "Cache-Control": NO_STORE } });
  if (!supabaseConfigured()) return answer({ error: "unavailable" }, 503);
  const session = await getSessionProfile();
  if (!session || !isAdminRole(session.role)) return answer({ error: "forbidden" }, 404);
  const days = readWindow(new URL(request.url).searchParams.get("days"));
  const usage = await readUsage(days);
  return usage ? answer(usage) : answer({ error: "failed" }, 502);
}
