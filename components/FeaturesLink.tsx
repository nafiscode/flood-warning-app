"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";

/**
 * Two quiet lines at the end of every page: "What Jaga can do" (A17) and "How Jaga works"
 * (A18), so anyone can find what the app is for and how it was built. Not on the pages where
 * someone is asking for help or reporting, and neither link is shown on the page it leads to.
 *
 * Each link keeps its own wrapper, so a test (or a tour) can point at one of them alone.
 */
const QUIET = /^\/(sos|supplies|report)(\/|$)/;

export function FeaturesLink() {
  const t = useTranslations("capabilities");
  const how = useTranslations("howItWorks");
  const pathname = usePathname();
  if (QUIET.test(pathname)) return null;
  const onFeatures = /^\/features(\/|$)/.test(pathname);
  const onHow = /^\/how-it-works(\/|$)/.test(pathname);
  if (onFeatures && onHow) return null;
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
    </div>
  );
}
