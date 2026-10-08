import { useLocale, useTranslations } from "next-intl";
import { PhoneIcon } from "@/components/icons";
import { SOSButton } from "@/components/sos/SOSButton";
import { getPathname } from "@/i18n/navigation";
import type { Hazard } from "@/lib/hazards";
import { localName } from "@/lib/places";
import { card, hint } from "@/lib/ui";

/**
 * The card of a "coming soon" hazard (spec section 13): what the feature will do, the plain
 * statement that forecasts aren't available yet and that this does not mean there is no risk,
 * then SOS and the right hotline. No map, no layer, no level and no color that could read as
 * "all clear" (safety rule 10).
 */
export function HazardPlaceholder({ hazard }: { hazard: Hazard }) {
  const t = useTranslations("map.hazard");
  const locale = useLocale();
  return (
    <section className={card} data-hazard-placeholder={hazard.code}>
      <h2 className="text-h3 font-bold text-jaga-slate">
        {localName(hazard.name, locale)}
        <span className={`block font-normal ${hint}`}>{t("comingSoon")}</span>
      </h2>
      <p className="font-bold">{localName(hazard.placeholder, locale)}</p>
      <p>
        <span className={`block ${hint}`}>{t("willDo")}</span>
        {localName(hazard.description, locale)}
      </p>
      <SOSButton href={getPathname({ href: "/sos", locale })} />
      <a
        href={`tel:${hazard.hotline}`}
        className="flex min-h-16 w-full items-center justify-center gap-3 rounded-2xl bg-jaga-slate px-5 py-3 text-h3 font-bold text-white active:translate-y-px"
      >
        <PhoneIcon size={28} />
        {t("call", { number: hazard.hotline })}
      </a>
    </section>
  );
}
