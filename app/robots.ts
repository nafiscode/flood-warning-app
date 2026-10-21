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

/** The one page under a closed path that should be findable: how a rescue team signs itself up. */
const OPEN = ["/authority/register"];

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
        // Longest match wins, so the register page survives the closed `/authority` above it.
        allow: ["/", ...perLocale(OPEN)],
        disallow: ["/api/", ...perLocale(CLOSED)],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
