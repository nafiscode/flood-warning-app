import { getSessionProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/supabase/env";
import { NO_STORE } from "@/lib/supabase/public";

/**
 * The signed-in person's role, for the Admin link in the header, and whether they have registered
 * a unit at all, for the invitation to register one (18 Oct). Read with their own session and
 * never cached; a visitor gets null. It says nothing personal: the role alone, and a yes or no
 * about the caller — no unit's name, status or number. What an admin may actually read or change
 * is decided by row-level security and the admin pages themselves, never by this answer
 * (safety rule 5).
 */
export async function GET() {
  const answer = (role: string | null, hasUnit = false) =>
    Response.json({ role, hasUnit }, { headers: { "Cache-Control": NO_STORE } });
  if (!supabaseConfigured()) return answer(null);
  const session = await getSessionProfile();
  if (!session) return answer(null);
  // Counted through their own session, so the policies decide what is counted, and with `head`
  // so no row crosses the wire: the number itself is never used, only whether it is above zero.
  const supabase = await createClient();
  const { count } = await supabase
    .from("authority_units")
    .select("id", { count: "exact", head: true })
    .eq("user_id", session.userId);
  if ((count ?? 0) > 0) return answer(session.role, true);
  // A person an owner has let into a team (or who is waiting to be) is not asked to register one.
  const { count: joined } = await supabase
    .from("authority_unit_members")
    .select("id", { count: "exact", head: true })
    .eq("user_id", session.userId)
    .in("status", ["pending", "active"]);
  return answer(session.role, (joined ?? 0) > 0);
}
