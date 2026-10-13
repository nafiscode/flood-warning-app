import { after } from "next/server";
import { handleLineEvents, lineSignatureOk } from "@/lib/line-server";
import { NO_STORE } from "@/lib/supabase/public";

/**
 * LINE's webhook (A7): the Official Account telling Jaga that someone added it, blocked it or
 * wrote to it. Nothing is believed without LINE's signature over the exact bytes received. The
 * answer goes back at once, as LINE requires, and the work is done after it.
 */
export const maxDuration = 30;

export async function POST(request: Request) {
  const answer = (body: unknown, status = 200) =>
    Response.json(body, { status, headers: { "Cache-Control": NO_STORE } });
  const body = await request.text();
  if (!lineSignatureOk(body, request.headers.get("x-line-signature"))) {
    return answer({ error: "not_found" }, 404);
  }
  let events: unknown = [];
  try {
    events = (JSON.parse(body) as { events?: unknown }).events ?? [];
  } catch {
    return answer({ error: "bad_request" }, 400);
  }
  if (Array.isArray(events) && events.length > 0) {
    after(() => handleLineEvents(events as Parameters<typeof handleLineEvents>[0]));
  }
  return answer({ ok: true });
}
