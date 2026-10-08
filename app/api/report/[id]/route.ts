import { supabaseConfigured } from "@/lib/supabase/env";
import { NO_STORE } from "@/lib/supabase/public";
import { createClient } from "@/lib/supabase/server";

/**
 * The paths of the photos and voice note of one's own report, once they are in Storage (spec
 * 4.5). The bytes never pass through here: the phone uploads them straight to the private bucket
 * and this records where they are. Row-level security limits the change to the reporter's own
 * report, and only while it is still pending moderation.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request, context: RouteContext<"/api/report/[id]">) {
  const { id } = await context.params;
  const answer = (body: unknown, status = 200) =>
    Response.json(body, { status, headers: { "Cache-Control": NO_STORE } });
  if (!UUID.test(id)) return answer({ error: "not_found" }, 404);
  if (!supabaseConfigured()) return answer({ error: "unavailable" }, 503);

  let input: { photos?: string[]; voice?: string | null };
  try {
    input = (await request.json()) as { photos?: string[]; voice?: string | null };
  } catch {
    return answer({ error: "bad_request" }, 400);
  }
  // Only paths under this report's own folder, which is what the storage policy allows too.
  const photos = (Array.isArray(input.photos) ? input.photos : [])
    .filter((p): p is string => typeof p === "string" && p.startsWith(`${id}/`))
    .slice(0, 3);
  const voice =
    typeof input.voice === "string" && input.voice.startsWith(`${id}/`) ? input.voice : null;
  if (photos.length === 0 && !voice) return answer({ ok: true });

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims.sub) return answer({ error: "sign_in" }, 401);
  const { data, error } = await supabase
    .from("reports")
    .update({ ...(photos.length > 0 ? { photos } : {}), ...(voice ? { voice_url: voice } : {}) })
    .eq("id", id)
    .select("id");
  if (error) return answer({ error: "unavailable" }, 503);
  if (!data || data.length === 0) return answer({ error: "not_yours" }, 403);
  return answer({ ok: true });
}
