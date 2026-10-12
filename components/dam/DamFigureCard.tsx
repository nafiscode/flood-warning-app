"use client";

import { useLocale, useTranslations } from "next-intl";
import { DamSectionFigure } from "@/components/dam/DamFigures";
import type { Dam } from "@/lib/dam";
import { localName } from "@/lib/places";
import { card, hint } from "@/lib/ui";

/**
 * The dam's figure on the home screen (the owner's choice of 12 Oct: everyone in Yala, Pattani
 * and Narathiwat sees it, Songkhla does not - see `showsDamFigure` for why).
 *
 * It is deliberately not the quiet notice: nothing here says water is coming. It says where the
 * dam is, what it is doing, and that these are the dam's own published figures and not an alert
 * from Jaga (safety rule 2). It has no map link: on the home screen it sits directly above the
 * "Open the map" button (owner, 13 Oct). Someone on the river gets the notice instead **while
 * the dam has something to say**; on an ordinary day the notice is silent, so they get this card
 * too, with `onRiver` so the sentence beneath the drawing tells them the truth about where they
 * live.
 */
export function DamFigureCard({ dam, onRiver = false }: { dam: Dam; onRiver?: boolean }) {
  const t = useTranslations("dam");
  const locale = useLocale();
  const name = localName(dam.name, locale);
  return (
    <section className={card} data-dam-figure-card={dam.code} data-dam-on-river={onRiver}>
      <p className="text-h3 font-bold text-jaga-ink">{t("figure.cardTitle", { dam: name })}</p>
      <DamSectionFigure dam={dam} />
      <p className={hint}>
        {t(onRiver ? "figure.cardWhereOnPath" : "figure.cardWhere", {
          river: localName(dam.river, locale),
        })}
      </p>
      <p className={hint}>{t("disclaimer.notAnAlert")}</p>
    </section>
  );
}
