import type { Provider } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";
import { localePath, safeNextPath } from "@/lib/auth";
import { isPhoneBrowser, lineSignInConfigured } from "@/lib/features";
import { supabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

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
  const asJson = searchParams.get("format") === "json";
  if (!supabaseConfigured() || !lineSignInConfigured()) {
    return asJson ? NextResponse.json({ url: null }) : back("unavailable");
  }

  // On a computer or tablet LINE would ask for an email and password first; show the QR code
  // instead, to scan with the LINE app. Never on a phone: nobody can scan their own screen.
  const onPhone = isPhoneBrowser(request.headers.get("user-agent"));
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    // LINE is a custom OAuth2 provider in Supabase Auth (decision 2026-10-05).
    provider: "custom:line" as Provider,
    options: {
      redirectTo: `${origin}/api/auth/callback${next ? `?next=${encodeURIComponent(next)}` : ""}`,
      scopes: "openid profile",
      // Offer "add Jaga as a friend" on LINE's consent screen, so alerts can reach the person.
      queryParams: {
        bot_prompt: "normal",
        ui_locales: LINE_UI_LOCALES[locale] ?? LINE_UI_LOCALES_DEFAULT,
        ...(onPhone ? {} : { initial_amr_display: "lineqr" }),
      },
    },
  });
  if (error || !data.url) return asJson ? NextResponse.json({ url: null }) : back("line");

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
  const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
  // The page asks for the address itself (format=json) to turn its button into a link to LINE.
  if (asJson) {
    return NextResponse.json(
      { url: target.startsWith(`${LINE_AUTHORIZE}?`) ? target : null },
      { headers },
    );
  }
  return NextResponse.redirect(target, { headers });
}
