import { readAuthorityBoard } from "@/lib/authority-board";
import { getSessionProfile } from "@/lib/auth";
import { supabaseConfigured } from "@/lib/supabase/env";
import { NO_STORE } from "@/lib/supabase/public";

/**
 * The authority console's own refresh (spec 5.1): the cases in the caller's coverage and the
 * caller's units, every few seconds while the console is open. Read with the responder's own
 * session, so the database decides what comes back - authority_board() refuses anyone who has no
 * verified unit, and that refusal is answered with the same "not found" a visitor gets. Never
 * cached, and no phone number is in the answer (safety rule 5).
 */
const answer = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": NO_STORE } });

export async function GET() {
  if (!supabaseConfigured()) return answer({ error: "unavailable" }, 503);
  const session = await getSessionProfile();
  if (!session) return answer({ error: "forbidden" }, 404);
  try {
    return answer(await readAuthorityBoard(session.userId));
  } catch {
    return answer({ error: "forbidden" }, 404);
  }
}
