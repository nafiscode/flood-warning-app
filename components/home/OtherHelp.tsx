"use client";

import { useTranslations } from "next-intl";
import { PhoneIcon } from "@/components/icons";
import { buttonSecondary } from "@/lib/ui";
import { SuppliesLink } from "./SuppliesLink";

/**
 * "Other ways to ask for help", folded under SOS on a laptop for someone who has not signed in
 * (the owner, 23 Oct 2026). SOS stays the one big button; this holds what is quieter than it:
 * food and water, and the project's own phone line when there is one. Nothing is behind a login
 * and nothing here ever stands between a person and SOS.
 */
export function OtherHelp({ projectLine }: { projectLine: string | null }) {
  const t = useTranslations("homeFlow");
  const tHome = useTranslations("home");
  return (
    <details
      data-other-help="true"
      className="group rounded-xl border border-jaga-line bg-jaga-surface"
    >
      <summary className="flex min-h-tap cursor-pointer list-none items-center justify-between gap-2 px-4 font-medium text-jaga-ink [&::-webkit-details-marker]:hidden">
        {t("otherHelp")}
        <span aria-hidden="true" className="transition-transform group-open:rotate-180">
          ▾
        </span>
      </summary>
      <div className="flex flex-col gap-3 px-3 pb-3">
        <SuppliesLink />
        {projectLine && (
          <a href={`tel:${projectLine}`} className={`${buttonSecondary} gap-2`}>
            <PhoneIcon size={22} />
            {tHome("projectLine")} {projectLine}
          </a>
        )}
      </div>
    </details>
  );
}
