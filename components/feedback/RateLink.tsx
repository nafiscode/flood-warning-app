"use client";

import { useTranslations } from "next-intl";
import { MessageIcon } from "@/components/icons";
import { Link, usePathname } from "@/i18n/navigation";
import { quietScreen } from "@/lib/feedback";
import { useTense } from "@/lib/use-tense";
import { buttonSecondary } from "@/lib/ui";

/**
 * "Rate Jaga" where it is offered as a button rather than a line at the foot of the page: on the
 * Account page and at the end of "Who built Jaga" (spec 17).
 *
 * It carries the same gate as the page-end line: never on an SOS, food-and-water, report or alert
 * screen, and never while a place of this person's is at Warning or Evacuate. The page stays
 * reachable at its address throughout; this is only the invitation.
 *
 * A client component so it can read the phone's own last alert status without asking the server
 * (lib/use-tense.ts). Its one word comes from the layout's message set, which every page has.
 */
export function RateLink({ className, where }: { className?: string; where: string }) {
  const t = useTranslations("feedback");
  const pathname = usePathname();
  const tense = useTense();
  if (tense || quietScreen(pathname) || /^\/feedback(\/|$)/.test(pathname)) return null;
  return (
    <Link
      href="/feedback"
      prefetch={false}
      className={className ?? buttonSecondary}
      data-feedback-link={where}
    >
      <MessageIcon size={22} />
      {t("link")}
    </Link>
  );
}
