import type { Metadata } from "next";
import { routing } from "@/i18n/routing";

/**
 * How Jaga is found by search (A10). Everything here is for crawlers only: nothing in this file
 * changes what a person sees, and nothing in it may ever gate a page - a search engine is not a
 * reader Jaga owes anything to, and a reader in a flood is (safety rule 1).
 *
 * Two jobs. It says which pages a search engine may keep, and it tells it that the Thai, Malay
 * and English copies of a page are the same page in three languages rather than three pages
 * saying the same thing - without that, the three compete with each other for the same query.
 */

/**
 * The pages a search engine should be able to find, in the order the sitemap lists them.
 *
 * Everything else is left out on purpose. The admin and team consoles, the account pages and
 * "my requests" hold or lead to somebody's data (safety rules 5 and 6); a case page at
 * `/sos/<id>` *is* somebody's emergency and must never reach a search result; `/sign-in` and
 * `/offline` say nothing to a reader who arrives from a search.
 */
export const INDEXED_PATHS = [
  "/",
  "/sos",
  "/supplies",
  "/report",
  "/map",
  "/weather",
  "/features",
  "/how-it-works",
  "/how-it-works/system",
  "/about",
  "/authority/register",
] as const;

/**
 * The address of a page in one language. Thai is the bare address and the other two carry their
 * code, which is what `localePrefix: "as-needed"` serves (i18n/routing.ts, decisions 2026-09-29).
 */
export function localeHref(locale: string, path: string): string {
  const rest = path === "/" ? "" : path;
  if (locale === routing.defaultLocale) return rest || "/";
  return `/${locale}${rest}`;
}

/**
 * The canonical address of this page and where its other languages are.
 *
 * `canonical` is the one address of the page being rendered, so a visit that arrives with a
 * tracking parameter on the end is not counted as a second page. `languages` is the hreflang set:
 * it must list *every* language including the one being rendered, and `x-default` names the copy
 * for a reader whose language Jaga has none of - Thai, because that is the printed address.
 */
export function alternates(locale: string, path: string): Metadata["alternates"] {
  const languages: Record<string, string> = { "x-default": localeHref(routing.defaultLocale, path) };
  for (const other of routing.locales) languages[other] = localeHref(other, path);
  return { canonical: localeHref(locale, path), languages };
}

/**
 * Keep this page out of search results. Spelled as metadata rather than only as a line in
 * robots.txt because the two do different things: robots.txt asks a crawler not to *fetch* a
 * page, and this asks it not to *keep* one it reached by a link from somewhere else.
 */
export const PRIVATE_PAGE: Metadata = { robots: { index: false, follow: false } };
