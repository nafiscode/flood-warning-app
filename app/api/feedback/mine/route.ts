import { supabaseConfigured } from "@/lib/supabase/env";
import { NO_STORE } from "@/lib/supabase/public";
import { createClient } from "@/lib/supabase/server";

/**
 * What became of a comment this device sent, and taking it back (A15, spec 17).
 *
 * A POST for a read, because the key travels in the body: a key in a query string ends up in
 * server logs and in the browser's history, and this one is the whole proof that an anonymous
 * comment is yours - the same reason an SOS token is read this way.
 *
 * `action: "withdraw"` deletes it. A signed-in sender needs no key; an anonymous one needs the
 * key their phone kept. Neither ever learns anything about a row that is not theirs: a wrong key
 * gets `null`, not a hint.
 */
export async function POST(request: Request) {
  const answer = (body: unknown, status = 200) =>
    Response.json(body, { status, headers: { "Cache-Control": NO_STORE } });
  if (!supabaseConfigured()) return answer({ error: "unavailable" }, 503);

  let input: { id?: unknown; key?: unknown; action?: unknown };
  try {
    input = (await request.json()) as typeof input;
  } catch {
    return answer({ error: "bad_request" }, 400);
  }
  const id = typeof input.id === "string" ? input.id : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return answer({ error: "bad_request" }, 400);
  }
  const key = typeof input.key === "string" && input.key.length >= 20 ? input.key : null;
  const supabase = await createClient();

  if (input.action === "withdraw") {
    const { data, error } = await supabase.rpc("withdraw_feedback", { p_id: id, p_key: key });
    // 42501: neither the account nor the key matches. Nothing is said about the row itself.
    if (error) {
      const refused = error.code === "42501";
      return answer({ error: refused ? "not_yours" : "unavailable" }, refused ? 403 : 503);
    }
    return answer({ withdrawn: data === true });
  }

  const { data, error } = await supabase.rpc("feedback_mine", { p_id: id, p_key: key });
  if (error) return answer({ error: "unavailable" }, 503);
  return answer({ feedback: data ?? null });
}
