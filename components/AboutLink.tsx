"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";

/** Not where someone is asking for help: nothing there should lead away from it. */
const QUIET = /^\/(sos|supplies)(\/|$)/;

/**
 * "About" in the header, beside Account (the owner, 20 Oct 2026). It opens "Who built Jaga",
 * which is also where the other two pages a reader might want are reachable from: the nav at its
 * head leads to the science and the system, and the block at its foot leads to all three.
 *
 * `has` is false where that page's content is absent - it does not live in this repository and
 * arrives with the build - so the header never offers a word that leads to a 404.
 *
 * A word rather than a mark, like Home, Map and Account beside it. **It replaces the "?" that
 * led straight to "What Jaga can do" (16 Oct)**, and that is what pays for it: measured in Thai
 * at 360 px, a fourth word takes the header from 156 px to 185 px and wraps all four labels onto
 * two lines; with the "?" gone it is 156 px again and nothing wraps. One informational way in
 * rather than two, and "What Jaga can do" is one tap further - from this page, and from the quiet
 * line at the foot of every page, which is unchanged.
 */
export function AboutLink({ has = false, className = "" }: { has?: boolean; className?: string }) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  if (!has || QUIET.test(pathname)) return null;
  return (
    <Link
      href="/about"
      prefetch={false}
      aria-current={/^\/about(\/|$)/.test(pathname) ? "page" : undefined}
      data-about-nav
      className={`inline-flex min-h-tap items-center rounded px-2 text-small font-medium text-white underline ${className}`}
    >
      {t("about")}
    </Link>
  );
}
