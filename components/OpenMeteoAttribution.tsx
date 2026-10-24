import { useTranslations } from "next-intl";

/** Required wherever Open-Meteo data appears (CLAUDE.md, spec section 10). */
export function OpenMeteoAttribution() {
  const t = useTranslations("attribution");
  return (
    <p className="text-small text-jaga-text-2">
      <a
        href="https://open-meteo.com/"
        target="_blank"
        rel="noopener noreferrer"
        className="relative inline-block text-jaga-teal-ink underline after:absolute after:inset-x-0 after:-inset-y-3 after:content-['']"
      >
        {t("openMeteo")}
      </a>
    </p>
  );
}
