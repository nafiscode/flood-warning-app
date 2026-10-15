"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";

/**
 * A quiet "What Jaga can do" line at the end of every page (A17), so anyone can find what the app
 * is for. Not on the pages where someone is asking for help or reporting, nor on the page itself.
 */
const QUIET = /^\/(sos|supplies|report|features)(\/|$)/;

export function FeaturesLink() {
  const t = useTranslations("capabilities");
  const pathname = usePathname();
  if (QUIET.test(pathname)) return null;
  return (
    <p className="mt-10 text-center" data-features-link>
      <Link
        href="/features"
        prefetch={false}
        className="inline-flex min-h-tap items-center px-2 font-medium text-jaga-ink underline"
      >
        {t("link")}
      </Link>
    </p>
  );
}
