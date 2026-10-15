import { routing } from "@/i18n/routing";

/** A path with the locale prefix the routing uses (Thai has none). Import-free of the server. */
function prefixed(locale: string, path: string): string {
  return locale === routing.defaultLocale ? path : `/${locale}${path === "/" ? "" : path}`;
}

/**
 * A same-site path to go to after sign-in, or null. Browsers and Node drop tabs and newlines from
 * a URL before reading it, so "/<tab>/evil.com" would become "//evil.com", another site: anything with
 * a control character or a space is refused, and the path must still be on this site once parsed.
 */
export function sameSitePath(next: string | null | undefined): string | null {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return null;
  if (/[\u0000-\u001f\u007f\s]/.test(next)) return null;
  const here = "https://same.invalid";
  let url: URL;
  try {
    url = new URL(next, here);
  } catch {
    return null;
  }
  if (url.origin !== here) return null;
  return url.pathname + url.search + url.hash;
}

/** The page to come back to, as a locale-prefixed same-site path; the home page otherwise. */
function backTo(locale: string, back: string | null): string {
  return prefixed(locale, sameSitePath(back) ?? "/");
}

/**
 * The sign-in page's address with a way back to where the person was (`?next=`), for links drawn
 * in the browser. A path with its locale prefix, as `/api/auth/line` and the sign-in forms expect.
 * Client components can use it: it imports nothing from the server.
 */
export function signInHref(locale: string, back: string | null): string {
  // Coming back to the sign-in page itself would only show the form again.
  if (back === "/sign-in" || back?.startsWith("/sign-in?")) return prefixed(locale, "/sign-in");
  return `${prefixed(locale, "/sign-in")}?${new URLSearchParams({ next: backTo(locale, back) })}`;
}

/**
 * One tap into LINE's own sign-in, coming back to the same page: what the "What you get" card's
 * button uses, so a visitor does not have to find the LINE button on a second page first. Where
 * LINE sign-in is not set up the route sends them to the sign-in page with a plain message.
 */
export function lineSignInHref(locale: string, back: string | null): string {
  return `/api/auth/line?${new URLSearchParams({ locale, next: backTo(locale, back) })}`;
}
