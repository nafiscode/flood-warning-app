import { getSessionProfile } from "@/lib/auth";
import { supabaseConfigured } from "@/lib/supabase/env";
import { NO_STORE } from "@/lib/supabase/public";

/**
 * The signed-in person's role, for the Admin link in the header. Read with their own session and
 * never cached; a visitor gets null. It says nothing personal: the role alone, and only about
 * the caller. What an admin may actually read or change is decided by row-level security and the
 * admin pages themselves, never by this answer (safety rule 5).
 */
export async function GET() {
  const answer = (role: string | null) =>
    Response.json({ role }, { headers: { "Cache-Control": NO_STORE } });
  if (!supabaseConfigured()) return answer(null);
  const session = await getSessionProfile();
  return answer(session?.role ?? null);
}
