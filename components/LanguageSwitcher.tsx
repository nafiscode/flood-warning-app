"use client";

import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

/** Plain links, one per language: works without JavaScript and keeps each URL's language fixed. */
export function LanguageSwitcher() {
  const t = useTranslations("language");
  const current = useLocale();
  const pathname = usePathname();
  return (
    <nav aria-label={t("label")}>
      <ul className="flex flex-wrap gap-x-1 text-small">
        {routing.locales.map((locale) => (
          <li key={locale}>
            <Link
              href={pathname}
              locale={locale}
              lang={locale}
              aria-current={locale === current ? "true" : undefined}
              className={`inline-flex min-h-tap items-center rounded px-2 ${
                locale === current ? "font-bold text-white underline" : "text-jaga-teal-light"
              }`}
            >
              {t(locale)}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
