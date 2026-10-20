import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { existsSync, readFileSync } from "node:fs";
import type { ReactNode } from "react";

/**
 * The copy of "Who built Jaga" is not in this repository (the owner, 20 Oct 2026): it comes down
 * from the site-content bucket during the build, into the gitignored `messages/about/`.
 *
 * So the tests for that page read it from there and **skip themselves where it is absent** -
 * which is every fork, and CI, which has no reason to hold one person's career. On the owner's
 * machine and in any build that fetched the content they run in full, which is where they are
 * worth having: they are the check that the page never carries a phone number, never shouts the
 * brand, and never links to the repository.
 */
type Tree = { [key: string]: string | Tree };

function read(locale: string): Tree | null {
  const file = `messages/about/${locale}.json`;
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8")) as Tree;
}

const th = read("th");
const ms = read("ms");
const en = read("en");

export const HAS_ABOUT = Boolean(th && ms && en);

/** The three locales, or empty stand-ins when the content is not on this machine. */
export const ABOUT = {
  th: th ?? ({} as Tree),
  ms: ms ?? ({} as Tree),
  en: en ?? ({} as Tree),
} as const;

/** Render with just this page's own namespace, the way the app assembles it at build time. */
export function renderWithAbout(ui: ReactNode, locale: "th" | "en" = "th") {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={{ about: ABOUT[locale] }}
      timeZone="Asia/Bangkok"
    >
      {ui}
    </NextIntlClientProvider>,
  );
}
