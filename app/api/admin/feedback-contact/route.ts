import { revealFeedbackContact } from "@/lib/admin-feedback";
import { getSessionProfile, isAdminRole } from "@/lib/auth";
import { supabaseConfigured } from "@/lib/supabase/env";
import { NO_STORE } from "@/lib/supabase/public";

/**
 * The contact a person left with their feedback, for an admin, on a tap (A15, spec 17; safety
 * rule 5). The database function decides and writes the look to the access log; the check here
 * only saves everyone else a round trip.
 *
 * It answers null where the consent was withdrawn or the item has been closed and the contact
 * cleared - a tap that finds nothing is still a tap that is logged, which is the point.
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
    return answer({ contact: await revealFeedbackContact(id) });
  } catch {
    return answer({ error: "refused" }, 409);
  }
}
