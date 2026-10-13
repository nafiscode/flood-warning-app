import type { SupabaseClient } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";
import { finishSignIn, safeNextPath } from "@/lib/auth";
import {
  isFlowId,
  isVerifierCookie,
  returnToAppPath,
  signedInNoticePath,
  unpackClaim,
  unpackVerifier,
} from "@/lib/sign-in-flow";
import { supabaseConfigured } from "@/lib/supabase/env";
import { createClient, type PlainCookie } from "@/lib/supabase/server";

/**
 * Where LINE sign-in and email links come back to: trade the one-time code for a session.
 *
 * A LINE sign-in started inside Messenger and similar apps comes back in the phone's own
 * browser, which does not hold the one-time key. The key is then taken from the database by
 * the id in the address (`flow`), and the person first sees whose account they are in: the
 * sign-in was not started in this browser, so it could be a link someone else prepared.
 *
 * A sign-in started in Jaga on the home screen is different (owner, 2026-10-13): the person
 * wants the app signed in, not this browser. The code is left in the database for the app to
 * collect (app/api/auth/finish) and this browser only says "go back to Jaga". That page offers
 * to finish here instead, which comes back to this route with `here=1` and no code.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"));
  const flow = searchParams.get("flow");
  const to = (path: string) => NextResponse.redirect(new URL(path, origin));

  // Finish with a key kept in the database, in a browser that did not start the sign-in.
  const finishElsewhere = async (
    supabase: SupabaseClient,
    theCode: string,
    extraCookies: PlainCookie[],
  ) => {
    // Someone already signed in here keeps their session: a prepared link must not replace it.
    const { data } = await supabase.auth.getClaims();
    if (data?.claims.sub) return to(await finishSignIn(supabase, next));
    const other = await createClient({ extraCookies });
    const { error } = await other.auth.exchangeCodeForSession(theCode);
    if (error) return to("/sign-in?error=link");
    return to(signedInNoticePath(await finishSignIn(other, next)));
  };

  if (!code && searchParams.get("here") === "1" && isFlowId(flow) && supabaseConfigured()) {
    const supabase = await createClient();
    const { data } = await supabase.rpc("sign_in_flow_claim", { p_id: flow });
    const claim = unpackClaim(data);
    // Nothing waiting any more: the app collected it, or it is too old.
    if (!claim || claim.verifier.length === 0) return to("/sign-in?error=link");
    return finishElsewhere(supabase, claim.code, claim.verifier);
  }

  if (code && supabaseConfigured()) {
    const startedHere = request.cookies.getAll().some((c) => isVerifierCookie(c.name));
    const supabase = await createClient();
    if (isFlowId(flow)) {
      if (!startedHere) {
        const { data: parked } = await supabase.rpc("sign_in_flow_park", {
          p_id: flow,
          p_code: code,
        });
        if (parked === true) return to(returnToAppPath(flow, next));
      }
      // Taken in every case, so the id in the address works once only.
      const { data: packed } = await supabase.rpc("sign_in_flow_take", { p_id: flow });
      const extraCookies = startedHere ? [] : unpackVerifier(packed);
      if (extraCookies.length > 0) return finishElsewhere(supabase, code, extraCookies);
    }
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return to(await finishSignIn(supabase, next));
  }
  // An expired email link comes back as otp_expired; any other error is from the LINE sign-in.
  const failed =
    !code && searchParams.has("error") && searchParams.get("error_code") !== "otp_expired";
  const reason = failed ? "line" : "link";
  return to(`/sign-in?error=${reason}`);
}
