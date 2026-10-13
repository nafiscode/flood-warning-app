import type { Provider } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";
import { localePath, safeNextPath } from "@/lib/auth";
import { isPhoneBrowser, lineSignInConfigured } from "@/lib/features";
import {
  FLOW_COOKIE,
  FLOW_COOKIE_SECONDS,
  FLOW_NEXT_COOKIE,
  newFlowId,
  packVerifier,
} from "@/lib/sign-in-flow";
import { supabaseConfigured } from "@/lib/supabase/env";
import { createClient, type PlainCookie } from "@/lib/supabase/server";

/**
 * Language of LINE's own log-in and consent screens (its `ui_locales` parameter), most wanted
 * first. Without it LINE follows the browser language, which is often English on Thai phones.
 * Malay falls back to Thai. Checked on the live site on 2026-10-05: LINE has Thai, Malay and English.
 */
const LINE_UI_LOCALES: Record<string, string | undefined> = {
  ms: "ms-MY th-TH",
  en: "en-US",
};
const LINE_UI_LOCALES_DEFAULT = "th-TH";
const LINE_AUTHORIZE = "https://access.line.me/oauth2/v2.1/authorize";

/**
 * Start a LINE sign-in. A plain link leads here and the answer is a redirect straight to LINE,
 * so on a phone the whole step is one navigation the person started by tapping: that is what
 * lets the phone hand over to the LINE app instead of showing LINE's web page. (A form posted
 * in the background and a hop through Supabase's address both left people on the web page.)
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const locale = searchParams.get("locale") ?? "";
  const next = safeNextPath(searchParams.get("next"));
  const back = (error: string) => {
    const query = new URLSearchParams({ error, ...(next ? { next } : {}) });
    return NextResponse.redirect(new URL(`${localePath(locale, "/sign-in")}?${query}`, origin));
  };
  if (!supabaseConfigured() || !lineSignInConfigured()) return back("unavailable");

  // On a computer or tablet LINE would ask for an email and password first; show the QR code
  // instead, to scan with the LINE app. Never on a phone: nobody can scan their own screen.
  const onPhone = isPhoneBrowser(request.headers.get("user-agent"));
  // The LINE app may hand the person back to another browser than this one (it does from
  // inside Messenger). So the one-time key Supabase sets as a cookie here is also kept in the
  // database, under an id that comes back in the return address.
  const flow = newFlowId();
  const set: PlainCookie[] = [];
  const supabase = await createClient({ onSetCookies: (cookies) => set.push(...cookies) });
  const { data, error } = await supabase.auth.signInWithOAuth({
    // LINE is a custom OAuth2 provider in Supabase Auth (decision 2026-10-05).
    provider: "custom:line" as Provider,
    options: {
      redirectTo: `${origin}/api/auth/callback?${new URLSearchParams({ flow, ...(next ? { next } : {}) })}`,
      scopes: "openid profile",
      // Offer "add Jaga as a friend" on LINE's consent screen, so alerts can reach the person.
      queryParams: {
        bot_prompt: "normal",
        ui_locales: LINE_UI_LOCALES[locale] ?? LINE_UI_LOCALES_DEFAULT,
        ...(onPhone ? {} : { initial_amr_display: "lineqr" }),
      },
    },
  });
  if (error || !data.url) return back("line");
  // Started in Jaga on the home screen: the LINE app will come back in the phone's browser, not
  // here. The flow is marked so that browser leaves the sign-in for this app to collect.
  const fromApp = searchParams.get("app") === "1";
  const verifier = packVerifier(set);
  let kept = false;
  if (verifier) {
    // If this fails the sign-in still works in the browser that started it.
    const { error: notKept } = await supabase.rpc("sign_in_flow_put", {
      p_id: flow,
      p_verifier: verifier,
    });
    kept = !notKept;
    if (kept && fromApp) await supabase.rpc("sign_in_flow_mark_app", { p_id: flow });
  }

  // Supabase answers its own address with a redirect to LINE. Follow that hop here, so the
  // browser goes to LINE directly. If it can't be followed, the browser takes the hop itself.
  let target = data.url;
  try {
    const hop = await fetch(data.url, { redirect: "manual", signal: AbortSignal.timeout(5000) });
    const location = hop.headers.get("location");
    if (location?.startsWith(`${LINE_AUTHORIZE}?`)) target = location;
  } catch {
    // Keep Supabase's address.
  }
  const response = NextResponse.redirect(target, {
    headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
  if (fromApp && kept) {
    // What the app asks about when the person comes back to it (components/SignInFinisher.tsx).
    // Readable by the page, so it only asks while there is something to ask about.
    const options = {
      path: "/",
      maxAge: FLOW_COOKIE_SECONDS,
      sameSite: "lax" as const,
      secure: origin.startsWith("https:"),
    };
    response.cookies.set(FLOW_COOKIE, flow, options);
    if (next) response.cookies.set(FLOW_NEXT_COOKIE, next, options);
  }
  return response;
}
