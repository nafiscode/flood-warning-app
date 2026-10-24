"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";

/**
 * Four quiet lines at the end of every page: "What Jaga can do" (A17), "How Jaga works" (A18),
 * "Who built Jaga" (20 Oct 2026) and Jaga's record of help (24 Oct 2026), so anyone can find what
 * the app is for, how it was built, who built it and what it carried. Not on the pages where
 * someone is asking for help or reporting, and no link is shown on the page it leads to. The
 * record's line is also kept off the home screen (spec section 16: nothing competes with a
 * request for help there).
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
  const pathname = usePathname();
  if (QUIET.test(pathname)) return null;
  const onFeatures = /^\/features(\/|$)/.test(pathname);
  const onHow = /^\/how-it-works(\/|$)/.test(pathname);
  const onAbout = /^\/about(\/|$)/.test(pathname);
  const onImpact = /^\/impact(\/|$)/.test(pathname);
  const showImpact = pathname !== "/" && !onImpact;
  const show = [!onFeatures, !onHow, hasAbout && !onAbout, showImpact].filter(Boolean).length;
  if (show === 0) return null;
  const line = "inline-flex min-h-tap items-center px-2 font-medium text-jaga-ink underline";
  return (
    <div className="mt-10 flex flex-wrap items-center justify-center gap-x-1 text-center">
      {!onFeatures && (
        <p data-features-link>
          <Link href="/features" prefetch={false} className={line}>
            {t("link")}
          </Link>
        </p>
      )}
      {!onFeatures && !onHow && (
        <span aria-hidden="true" className="text-jaga-text-2">
          &middot;
        </span>
      )}
      {!onHow && (
        <p data-how-link>
          <Link href="/how-it-works" prefetch={false} className={line}>
            {how("link")}
          </Link>
        </p>
      )}
      {!onHow && hasAbout && !onAbout && (
        <span aria-hidden="true" className="text-jaga-text-2">
          &middot;
        </span>
      )}
      {hasAbout && !onAbout && (
        <p data-about-link>
          <Link href="/about" prefetch={false} className={line}>
            {how("nav.about")}
          </Link>
        </p>
      )}
      {showImpact && (
        <>
          {(!onFeatures || !onHow || (hasAbout && !onAbout)) && (
            <span aria-hidden="true" className="text-jaga-text-2">
              &middot;
            </span>
          )}
          <p data-impact-link>
            <Link href="/impact" prefetch={false} className={line}>
              {record("link")}
            </Link>
          </p>
        </>
      )}
    </div>
  );
}
