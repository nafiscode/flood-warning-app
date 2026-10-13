import { gateOpens, runPushTick } from "@/lib/push-server";
import { NO_STORE } from "@/lib/supabase/public";

/**
 * The database's one-minute knock (A7): "see whether any notification about a request for help
 * is owed". It is what moves an offer on to the next team's phone while nobody has the app open.
 * Only a caller holding the token derived from Jaga's push signing key gets past; anyone else
 * gets a plain 404, and the route itself hands nothing out either way.
 */
export const maxDuration = 30;

export async function POST(request: Request) {
  const answer = (body: unknown, status = 200) =>
    Response.json(body, { status, headers: { "Cache-Control": NO_STORE } });
  if (!gateOpens(request.headers.get("x-jaga-push"))) return answer({ error: "not_found" }, 404);
  return answer(await runPushTick());
}
