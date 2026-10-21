import type { MetadataRoute } from "next";
import { getMessages } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { INDEXED_PATHS, localeHref } from "@/lib/seo";
import { siteUrl } from "@/lib/site";

/**
 * sitemap.xml: every public page, in every language, with its other languages beside it.
 *
 * One entry per page *per language* rather than one entry per page: that way each of the three
 * addresses is offered for crawling in its own right and carries the full set of alternates,
 * which is what Google asks for when a page exists in several languages.
 *
 * Which pages are listed is `INDEXED_PATHS` (lib/seo.ts), the same list the robots rules and the
 * per-page metadata work from, so a page cannot be in the sitemap and closed to crawlers at once.
 */

/**
 * "Who built Jaga" is the one listed page that may not exist: its words are fetched during the
 * build and are not in this repository, and the route takes itself out of existence when they are
 * absent (lib/about.ts). A sitemap that offered a 404 would be a sitemap a crawler stops trusting.
 */
async function missing(): Promise<Set<string>> {
  const gone = new Set<string>();
  for (const locale of routing.locales) {
    const messages = (await getMessages({ locale })) as { about?: unknown };
    if (!messages.about) gone.add(localeHref(locale, "/about"));
  }
  return gone;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const gone = await missing();
  const url = (locale: string, path: string) => new URL(localeHref(locale, path), base).toString();

  const entries: MetadataRoute.Sitemap = [];
  for (const path of INDEXED_PATHS) {
    for (const locale of routing.locales) {
      if (gone.has(localeHref(locale, path))) continue;
      const languages: Record<string, string> = {};
      // Thai first, as x-default: the copy for a reader whose language Jaga has none of.
      if (!gone.has(localeHref(routing.defaultLocale, path))) {
        languages["x-default"] = url(routing.defaultLocale, path);
      }
      for (const other of routing.locales) {
        if (!gone.has(localeHref(other, path))) languages[other] = url(other, path);
      }
      entries.push({ url: url(locale, path), alternates: { languages } });
    }
  }
  return entries;
}
