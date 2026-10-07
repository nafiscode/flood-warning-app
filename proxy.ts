import createMiddleware from "next-intl/middleware";
import { type NextRequest, NextResponse } from "next/server";
import { routing } from "./i18n/routing";
import { refreshSession } from "./lib/supabase/proxy";

const intl = createMiddleware(routing);
const HOME_PATHS = new Set(["/", ...routing.locales.map((locale) => `/${locale}`)]);

// Next.js 16 renamed middleware to proxy. It maps URLs to a language and keeps a signed-in
// session fresh; it never blocks a request and never requires sign-in (safety rule 1).
export default async function proxy(request: NextRequest) {
  // A sign-in link that lands on the home page (Supabase falls back to the site address when
  // the redirect address isn't on its allow-list) is handed to the callback. So is a sign-in
  // that failed at Supabase (for one, a LINE sign-in whose state was already used: seen
  // 2026-10-07), so the person reads why instead of a silent home page.
  const { searchParams } = request.nextUrl;
  if (
    (searchParams.has("code") || searchParams.has("error_code")) &&
    HOME_PATHS.has(request.nextUrl.pathname)
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/api/auth/callback";
    return NextResponse.redirect(url);
  }
  const refreshed = await refreshSession(request);
  const response = intl(request);
  for (const { name, value, options } of refreshed) response.cookies.set(name, value, options);
  return response;
}

export const config = {
  // Skip API routes, Next internals, the service worker route, and any file with an extension.
  matcher: ["/((?!api|_next|_vercel|serwist|.*\\..*).*)"],
};
