import type { MetadataRoute } from "next";
import { routing } from "@/i18n/routing";
import { siteUrl } from "@/lib/site";

/**
 * robots.txt. Until now there was none, so every crawler fetched the admin and account pages,
 * found a sign-in redirect and spent Jaga's own serving budget doing it.
 *
 * A crawler is asked away from three kinds of address: what holds or leads to somebody's data
 * (safety rules 5 and 6), what only makes sense to a signed-in person, and the API. The paths are
 * written out per language because `/admin`, `/ms/admin` and `/en/admin` are three addresses.
 *
 * This is not a security measure and is not treated as one: everything behind these paths is held
 * by row-level security in the database, which a crawler cannot ask nicely to step around.
 */
const CLOSED = [
  "/admin",
  "/authority",
  "/account",
  "/requests",
  "/sign-in",
  "/offline",
  "/dev",
  // A case page is somebody's emergency. `/sos` itself stays open: that is the page to arrive on.
  "/sos/",
];

/*
 * There is no exception any more. `/authority/register` was allowed back through here on the
 * belief that it is the public page a rescue team signs up on. It is not: it asks for a session
 * and redirects to /sign-in (proved against the live site, 22 Oct - it answered 307 in all three
 * languages). A crawler following it would only ever reach the sign-in page.
 *
 * The findable page for a team is the home screen, which has said since 18 Oct that a unit can
 * register and links here. That page is indexed; this one has nothing to show a crawler.
 */

function perLocale(paths: string[]): string[] {
  return paths.flatMap((path) =>
    routing.locales.map((locale) => (locale === routing.defaultLocale ? path : `/${locale}${path}`)),
  );
}

export default function robots(): MetadataRoute.Robots {
  const base = siteUrl();
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/"],
        disallow: ["/api/", ...perLocale(CLOSED)],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
