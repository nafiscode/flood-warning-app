import { revealHouseholdPhone } from "@/lib/authority-board";
import { getSessionProfile, isAdminRole } from "@/lib/auth";
import { supabaseConfigured } from "@/lib/supabase/env";
import { NO_STORE } from "@/lib/supabase/public";

/**
 * One household's phone number, for an admin. The database function decides (an admin, or a team
 * with rescue or coordination capability covering that tambon) and writes the look to the access
 * log; the check here only saves everyone else a round trip.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const answer = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": NO_STORE } });

export async function POST(request: Request) {
  if (!supabaseConfigured()) return answer({ error: "unavailable" }, 503);
  const session = await getSessionProfile();
  if (!session || !isAdminRole(session.role)) return answer({ error: "forbidden" }, 404);
  let input: { id?: unknown };
  try {
    input = (await request.json()) as typeof input;
  } catch {
    return answer({ error: "bad_request" }, 400);
  }
  const id = typeof input.id === "string" && UUID.test(input.id) ? input.id : null;
  if (!id) return answer({ error: "bad_request" }, 400);
  try {
    return answer({ phone: await revealHouseholdPhone(id) });
  } catch {
    return answer({ error: "refused" }, 409);
  }
}
