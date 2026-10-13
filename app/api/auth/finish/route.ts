import { type NextRequest, NextResponse } from "next/server";
import { finishSignIn, safeNextPath } from "@/lib/auth";
import { FLOW_COOKIE, FLOW_NEXT_COOKIE, isFlowId, unpackClaim } from "@/lib/sign-in-flow";
import { supabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

type Answer = { state: "none" | "waiting" | "failed" } | { state: "done"; to: string };

/**
 * Jaga on the home screen asks: has the LINE sign-in I started come back yet? The LINE app
 * returns to the phone's browser, never to an installed web app, so that browser leaves the
 * code in the database (app/api/auth/callback) and the app collects it here. The app still
 * holds the one-time key in its own cookies, so the session is made in the app itself.
 */
export async function POST(request: NextRequest) {
  const answer = (body: Answer, forget: boolean) => {
    const response = NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
    if (forget) {
      response.cookies.delete(FLOW_COOKIE);
      response.cookies.delete(FLOW_NEXT_COOKIE);
    }
    return response;
  };
  const flow = request.cookies.get(FLOW_COOKIE)?.value;
  if (!isFlowId(flow) || !supabaseConfigured()) return answer({ state: "none" }, true);

  const supabase = await createClient();
  const { data, error: failed } = await supabase.rpc("sign_in_flow_claim", { p_id: flow });
  // The database could not be asked: keep the cookie and let the app ask again.
  if (failed) return answer({ state: "waiting" }, false);
  const claim = unpackClaim(data);
  if (!claim) return answer({ state: "waiting" }, false);

  const { error } = await supabase.auth.exchangeCodeForSession(claim.code);
  if (error) return answer({ state: "failed" }, true);
  const next = safeNextPath(request.cookies.get(FLOW_NEXT_COOKIE)?.value ?? null);
  return answer({ state: "done", to: await finishSignIn(supabase, next) }, true);
}
