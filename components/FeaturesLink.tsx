"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { quietScreen } from "@/lib/feedback";
import { useTense } from "@/lib/use-tense";

/**
 * The quiet lines at the end of every page: "What Jaga can do" (A17), "How Jaga works" (A18),
 * "Who built Jaga" (20 Oct 2026), Jaga's record of help (24 Oct 2026) and "Rate Jaga" (A15,
 * 27 Oct 2026), so anyone can find what the app is for, how it was built, who built it, what it
 * carried, and where to say what is wrong with it.
 *
 * Not on the pages where somebody is asking for help or reporting, and no link is shown on the
 * page it leads to. The record's line is also kept off the home screen (spec section 16: nothing
 * competes with a request for help there).
 *
 * **"Rate Jaga" has a gate of its own** (spec 17): it is kept off the SOS, food-and-water, report
 * and alert screens *and* off every page while a place of this person's is at Warning or
 * Evacuate. The page itself stays reachable at its address throughout - it is the invitation that
 * stops, not the door.
 *
 * `hasAbout` comes from the layout, which can see the whole message set: that page's words are
 * not in this repository and arrive with the build, so where they are absent the line is not
 * drawn rather than pointing at a page that is not there.
 *
 * Each link keeps its own wrapper, so a test (or a tour) can point at one of them alone.
 */
const QUIET = /^\/(sos|supplies|report)(\/|$)/;

export function FeaturesLink({ hasAbout = false }: { hasAbout?: boolean }) {
  const t = useTranslations("capabilities");
  const how = useTranslations("howItWorks");
  const record = useTranslations("impactPublic");
  const rate = useTranslations("feedback");
  const pathname = usePathname();
  const tense = useTense();
  if (QUIET.test(pathname)) return null;

  const on = (base: string) => new RegExp(`^${base}(/|$)`).test(pathname);
  const links = [
    { key: "features", mark: "data-features-link", href: "/features", word: t("link") },
    { key: "how", mark: "data-how-link", href: "/how-it-works", word: how("link") },
    {
      key: "about",
      mark: "data-about-link",
      href: "/about",
      word: how("nav.about"),
      show: hasAbout,
    },
    {
      key: "impact",
      mark: "data-impact-link",
      href: "/impact",
      word: record("link"),
      // Never from home: nothing competes with a request for help there (spec 16).
      show: pathname !== "/",
    },
    {
      key: "feedback",
      mark: "data-feedback-link",
      href: "/feedback",
      word: rate("link"),
      show: !tense && !quietScreen(pathname),
    },
  ].filter((link) => link.show !== false && !on(link.href));

  if (links.length === 0) return null;
  const line = "inline-flex min-h-tap items-center px-2 font-medium text-jaga-ink underline";
  return (
    <div className="mt-10 flex flex-wrap items-center justify-center gap-x-1 text-center">
      {links.map((link, i) => (
        <span key={link.key} className="inline-flex items-center gap-x-1">
          {i > 0 && (
            <span aria-hidden="true" className="text-jaga-text-2">
              &middot;
            </span>
          )}
          <p {...{ [link.mark]: true }}>
            <Link href={link.href} prefetch={false} className={line}>
              {link.word}
            </Link>
          </p>
        </span>
      ))}
    </div>
  );
}
