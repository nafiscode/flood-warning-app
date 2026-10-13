import { supabaseConfigured } from "@/lib/supabase/env";
import { NO_STORE } from "@/lib/supabase/public";
import { createClient } from "@/lib/supabase/server";

/**
 * This phone's push subscription and the tambons it follows (A7). A visitor may subscribe: an
 * alert must reach someone who only chose their area on the home screen. The database accepts
 * only the browser makers' push services as addresses and keeps only tambons that exist.
 * DELETE turns notifications off for this phone.
 */
const answer = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": NO_STORE } });

type Input = {
  endpoint?: unknown;
  keys?: { p256dh?: unknown; auth?: unknown };
  tambons?: unknown;
  locale?: unknown;
};

async function read(request: Request): Promise<Input | null> {
  try {
    return (await request.json()) as Input;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  if (!supabaseConfigured()) return answer({ error: "unavailable" }, 503);
  const input = await read(request);
  const endpoint = typeof input?.endpoint === "string" ? input.endpoint : "";
  const p256dh = typeof input?.keys?.p256dh === "string" ? input.keys.p256dh : "";
  const auth = typeof input?.keys?.auth === "string" ? input.keys.auth : "";
  if (!endpoint || !p256dh || !auth) return answer({ error: "bad_request" }, 400);
  const tambons = (Array.isArray(input?.tambons) ? input.tambons : [])
    .filter((c): c is string => typeof c === "string" && /^\d{6}$/.test(c))
    .slice(0, 60);
  const supabase = await createClient();
  const { error } = await supabase.rpc("push_subscribe", {
    p_endpoint: endpoint,
    p_keys: { p256dh, auth },
    p_tambons: tambons,
    p_locale: typeof input?.locale === "string" ? input.locale : "th",
  });
  if (error)
    return answer(
      { error: error.code === "22023" ? "bad_request" : "unavailable" },
      error.code === "22023" ? 400 : 503,
    );
  return answer({ ok: true, tambons: tambons.length });
}

export async function DELETE(request: Request) {
  if (!supabaseConfigured()) return answer({ error: "unavailable" }, 503);
  const input = await read(request);
  const endpoint = typeof input?.endpoint === "string" ? input.endpoint : "";
  if (!endpoint) return answer({ error: "bad_request" }, 400);
  const supabase = await createClient();
  const { error } = await supabase.rpc("push_unsubscribe", { p_endpoint: endpoint });
  if (error) return answer({ error: "unavailable" }, 503);
  return answer({ ok: true });
}
