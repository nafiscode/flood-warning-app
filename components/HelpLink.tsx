"use client";

import { useTranslations } from "next-intl";
import { QuestionIcon } from "@/components/icons";
import { Link, usePathname } from "@/i18n/navigation";

/** Not where someone is asking for help: nothing there should lead away from it. */
const QUIET = /^\/(sos|supplies)(\/|$)/;

/**
 * The "?" (owner, 16 Oct): What Jaga can do, one tap away on every page. Beside the bell from a
 * tablet's width up; on a phone at the end of the links' row, because the top row has no room
 * left in Thai while the weather pill still says "weather" in words (it made the header 48 px
 * taller). Drawn like the bell: 36 px wide, the hit area stretched back out to 48 px.
 */
export function HelpLink({ className = "" }: { className?: string }) {
  const t = useTranslations("capabilities");
  const pathname = usePathname();
  if (QUIET.test(pathname)) return null;
  return (
    <Link
      href="/features"
      prefetch={false}
      aria-label={t("link")}
      title={t("link")}
      aria-current={pathname === "/features" ? "page" : undefined}
      data-help-link
      className={`relative min-h-tap w-9 items-center justify-center rounded text-white after:absolute after:-inset-x-1 after:inset-y-0 after:content-[''] lg:w-12 ${className}`}
    >
      <QuestionIcon size={24} />
    </Link>
  );
}
