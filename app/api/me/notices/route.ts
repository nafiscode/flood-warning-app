import { supabaseConfigured } from "@/lib/supabase/env";
import { NO_STORE } from "@/lib/supabase/public";
import { createClient } from "@/lib/supabase/server";

/**
 * Which notices this person has already read, kept with their account so a second phone or a new
 * browser opens with the same things read (the owner's choice, 10 Oct). The browser keeps its
 * own list as well, which is what makes the bell work for a visitor and offline; this merges the
 * two: it sends what the phone has read and gets back everything the account has.
 *
 * A visitor gets an empty list and nothing is written. The ids say nothing about the person —
 * an alert id is public — and the database keeps only the caller's own rows (safety rule 5).
 */
const answer = (ids: string[], status = 200) =>
  Response.json({ read: ids }, { status, headers: { "Cache-Control": NO_STORE } });

export async function POST(request: Request) {
  if (!supabaseConfigured()) return answer([]);
  let ids: string[] = [];
  try {
    const body = (await request.json()) as { read?: unknown };
    if (Array.isArray(body.read)) {
      ids = body.read
        .filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 120)
        .slice(0, 500);
    }
  } catch {
    // No body, or not JSON: treat it as "I have read nothing new, tell me what I have read".
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("notices_sync", { p_ids: ids });
  if (error) return answer([], 503);
  const rows = Array.isArray(data) ? data : [];
  return answer(rows.map((row) => (typeof row === "string" ? row : String(row?.notice_id ?? ""))));
}
