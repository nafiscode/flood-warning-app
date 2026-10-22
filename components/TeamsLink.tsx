"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { useHasUnit } from "@/lib/use-public";

/** Not where someone is asking for help: nothing there should lead away from it. */
const QUIET = /^\/(sos|supplies)(\/|$)/;

/**
 * "For rescue teams" in the laptop header (the owner, 23 Oct 2026). Ten people had signed in and
 * no unit had registered (18 Oct), and a first visitor on a laptop now sees one question rather
 * than a card for every audience, so the way in for a team lives in the header and in the quiet
 * row under the question (components/home/HomeFirst.tsx), where it is always one tap away.
 *
 * Laptops and tablets held sideways only: a phone's header is one row and its menu has the room
 * (the owner approved that on 23 Oct). Nothing for someone whose unit is registered already.
 */
export function TeamsLink() {
  const t = useTranslations("homeFlow");
  const pathname = usePathname();
  const hasUnit = useHasUnit();
  if (hasUnit || QUIET.test(pathname)) return null;
  return (
    <Link
      href="/authority/register"
      prefetch={false}
      aria-current={/^\/authority\/register(\/|$)/.test(pathname) ? "page" : undefined}
      data-teams-nav
      className="inline-flex min-h-tap items-center rounded px-2 text-small font-medium text-white underline max-lg:hidden"
    >
      {t("navTeams")}
    </Link>
  );
}
