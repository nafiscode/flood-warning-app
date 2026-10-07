import { type NextRequest, NextResponse } from "next/server";
import { finishSignIn, safeNextPath } from "@/lib/auth";
import { isFlowId, isVerifierCookie, signedInNoticePath, unpackVerifier } from "@/lib/sign-in-flow";
import { supabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

/**
 * Where LINE sign-in and email links come back to: trade the one-time code for a session.
 *
 * A LINE sign-in started inside Messenger and similar apps comes back in the phone's own
 * browser, which does not hold the one-time key. The key is then taken from the database by
 * the id in the address (`flow`), and the person first sees whose account they are in: the
 * sign-in was not started in this browser, so it could be a link someone else prepared.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"));
  const flow = searchParams.get("flow");
  if (code && supabaseConfigured()) {
    const startedHere = request.cookies.getAll().some((c) => isVerifierCookie(c.name));
    let supabase = await createClient();
    let otherBrowser = false;
    if (isFlowId(flow)) {
      // Taken in every case, so the id in the address works once only.
      const { data: packed } = await supabase.rpc("sign_in_flow_take", { p_id: flow });
      const extraCookies = startedHere ? [] : unpackVerifier(packed);
      if (extraCookies.length > 0) {
        // Someone already signed in here keeps their session: a prepared link must not replace it.
        const { data } = await supabase.auth.getClaims();
        if (data?.claims.sub) {
          return NextResponse.redirect(new URL(await finishSignIn(supabase, next), origin));
        }
        supabase = await createClient({ extraCookies });
        otherBrowser = true;
      }
    }
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const destination = await finishSignIn(supabase, next);
      return NextResponse.redirect(
        new URL(otherBrowser ? signedInNoticePath(destination) : destination, origin),
      );
    }
  }
  // An expired email link comes back as otp_expired; any other error is from the LINE sign-in.
  const failed =
    !code && searchParams.has("error") && searchParams.get("error_code") !== "otp_expired";
  const reason = failed ? "line" : "link";
  return NextResponse.redirect(new URL(`/sign-in?error=${reason}`, origin));
}
