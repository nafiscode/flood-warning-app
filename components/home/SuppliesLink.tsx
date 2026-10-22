"use client";

import { useTranslations } from "next-intl";
import { ParcelIcon } from "@/components/icons";
import { Link } from "@/i18n/navigation";
import { buttonSecondary } from "@/lib/ui";

/**
 * "Request food and water", for someone safe but cut off (spec 4.10). Quieter than SOS and never
 * in its way. The home screen draws it in the action column, or, for a laptop visitor who has not
 * signed in, inside "Other ways to ask for help" (components/home/HomeFirst.tsx).
 */
export function SuppliesLink() {
  const tSos = useTranslations("sos");
  return (
    <Link
      href="/supplies"
      prefetch={false}
      data-supplies-link="true"
      className={`${buttonSecondary} min-h-16 gap-3`}
    >
      <ParcelIcon size={30} />
      <span className="flex flex-col items-start leading-tight">
        <span className="text-h3 font-bold">{tSos("supplies.label")}</span>
        <span className="text-small font-normal">{tSos("supplies.homeHint")}</span>
      </span>
    </Link>
  );
}
