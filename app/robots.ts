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
 * A page that is merely pointless to a reader arriving from a search is *not* closed here: it
 * carries `noindex` instead, which is the tag that removes it. See the note under the list.
 *
 * This is not a security measure and is not treated as one: everything behind these paths is held
 * by row-level security in the database, which a crawler cannot ask nicely to step around.
 */
const CLOSED = [
  "/admin",
  "/authority",
  "/account",
  "/requests",
  "/dev",
  // A case page is somebody's emergency. `/sos` itself stays open: that is the page to arrive on.
  "/sos/",
];

/*
 * `/sign-in` and `/offline` were in the list above until 9 Nov and are deliberately not any more.
 * Both already answer `noindex` in their own page metadata (PRIVATE_PAGE, lib/seo.ts), and a
 * crawler cannot read a tag on a page it has been told not to fetch: Search Console was holding
 * `/ms/sign-in?next=/ms/map` as "duplicate without user-selected canonical" for exactly that
 * reason - found through a link, unfetchable, so neither the noindex nor a canonical could be
 * seen. Letting the fetch through is what takes such a page back out of the index.
 *
 * Nothing is given away by the fetch: both pages are the same for everyone and hold no data. The
 * paths above are different - they lead to somebody's data (safety rules 5 and 6), so there the
 * crawl budget and the closed door are worth more than a tag a crawler would read once.
 */

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
