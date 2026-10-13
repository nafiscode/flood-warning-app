import { toUnitRequest, type UnitRequest } from "@/lib/journey";
import { supabaseConfigured } from "@/lib/supabase/env";
import { NO_STORE } from "@/lib/supabase/public";
import { createClient } from "@/lib/supabase/server";

/**
 * What a signed-in person has asked of Jaga that an admin acts on: for now, the teams they have
 * registered and where each registration stands. Their own rows only - row-level security lets a
 * person read the units they own - and never cached. No phone number is in the answer.
 *
 * Requests for help are not here: a phone follows those with the key it holds for each case, so
 * they work without an account.
 */
export async function GET() {
  const answer = (body: unknown, status = 200) =>
    Response.json(body, { status, headers: { "Cache-Control": NO_STORE } });
  if (!supabaseConfigured()) return answer({ error: "unavailable" }, 503);
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const user = claims?.claims.sub;
  if (!user) return answer({ error: "sign_in" }, 401);
  const { data, error } = await supabase
    .from("authority_units")
    .select("id, unit_name, status, created_at, verified_at, updated_at")
    // A verified team can read every unit; this page is about the caller's own.
    .eq("user_id", user)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) return answer({ error: "unavailable" }, 503);
  return answer({
    units: ((data ?? []) as Record<string, unknown>[])
      .map(toUnitRequest)
      .filter((u): u is UnitRequest => u !== null),
  });
}
