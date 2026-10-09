import { readBoard } from "@/lib/admin-board";
import { getSessionProfile, isAdminRole } from "@/lib/auth";
import { supabaseConfigured } from "@/lib/supabase/env";
import { NO_STORE } from "@/lib/supabase/public";

/**
 * The war room's own refresh: the counters and the case board, every 20 seconds while an admin
 * has the page open. Read with the admin's own session, so the database decides what comes back;
 * the check here only saves a pointless round trip for everyone else. Never cached, and no phone
 * number is in the answer (safety rule 5).
 */
export async function GET() {
  if (!supabaseConfigured()) {
    return Response.json(
      { error: "unavailable" },
      { status: 503, headers: { "Cache-Control": NO_STORE } },
    );
  }
  const session = await getSessionProfile();
  if (!session || !isAdminRole(session.role)) {
    return Response.json(
      { error: "forbidden" },
      { status: 404, headers: { "Cache-Control": NO_STORE } },
    );
  }
  const board = await readBoard();
  return Response.json(board, { headers: { "Cache-Control": NO_STORE } });
}
