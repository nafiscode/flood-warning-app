import { describe, expect, it } from "vitest";
import robots from "@/app/robots";
import { routing } from "@/i18n/routing";
import { alternates, INDEXED_PATHS, localeHref, PRIVATE_PAGE } from "@/lib/seo";

/**
 * What a search engine is told. The two halves - the pages offered for crawling and the pages
 * closed to it - are written in two files, and the way to get this wrong is for them to disagree:
 * a page both listed and disallowed is a page nobody can find and a crawler stops trusting the
 * sitemap over. These tests hold the two to each other.
 */

const rules = robots().rules;
const only = Array.isArray(rules) ? rules[0] : rules;
if (!only) throw new Error("robots.txt has no rules");
const disallow = [only.disallow ?? []].flat();
const allow = [only.allow ?? []].flat();

describe("where a page lives in each language", () => {
  it("Thai is the bare address and the other two carry their code", () => {
    expect(localeHref("th", "/")).toBe("/");
    expect(localeHref("th", "/map")).toBe("/map");
    expect(localeHref("ms", "/")).toBe("/ms");
    expect(localeHref("en", "/how-it-works/system")).toBe("/en/how-it-works/system");
  });

  it("the hreflang set names every language and the page being rendered among them", () => {
    const found = alternates("ms", "/sos");
    expect(found?.canonical).toBe("/ms/sos");
    for (const locale of routing.locales) {
      expect(found?.languages?.[locale]).toBe(localeHref(locale, "/sos"));
    }
    // A reader whose language Jaga has none of gets Thai: the printed address.
    expect(found?.languages?.["x-default"]).toBe("/sos");
  });
});

describe("robots.txt", () => {
  it("closes the admin and team consoles, the account pages and a case page, in every language", () => {
    for (const locale of routing.locales) {
      const at = (path: string) => (locale === routing.defaultLocale ? path : `/${locale}${path}`);
      for (const closed of ["/admin", "/authority", "/account", "/requests", "/sign-in", "/dev"]) {
        expect(disallow).toContain(at(closed));
      }
      // Somebody's own emergency, never a search result - but /sos itself stays open.
      expect(disallow).toContain(at("/sos/"));
      expect(disallow).not.toContain(at("/sos"));
    }
  });

  it("lets a rescue team's sign-up page through the closed path above it", () => {
    for (const locale of routing.locales) {
      const at = (path: string) => (locale === routing.defaultLocale ? path : `/${locale}${path}`);
      expect(allow).toContain(at("/authority/register"));
    }
  });

  it("names the sitemap, so a crawler that reads only this file still finds every page", () => {
    expect(robots().sitemap).toMatch(/\/sitemap\.xml$/);
  });
});

describe("the two lists agree", () => {
  it("no page is both offered for crawling and closed to crawlers", () => {
    for (const path of INDEXED_PATHS) {
      const blocked = disallow.filter((closed) => path.startsWith(closed));
      // Longest match wins in robots.txt, so a closed path is only real if nothing allows it back.
      for (const closed of blocked) {
        const rescued = allow.some((open) => path.startsWith(open) && open.length > closed.length);
        expect(rescued, `${path} is disallowed by ${closed} and never allowed back`).toBe(true);
      }
    }
  });
});

describe("a page closed to search", () => {
  it("is told not to be kept and not to be followed", () => {
    expect(PRIVATE_PAGE.robots).toEqual({ index: false, follow: false });
  });
});
