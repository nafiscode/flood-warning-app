"use client";

import { useLocale, useTranslations } from "next-intl";
import { DamSectionFigure } from "@/components/dam/DamFigures";
import { WaveIcon } from "@/components/icons";
import { DamArrivalLines } from "@/components/map/DamArrival";
import { Link } from "@/i18n/navigation";
import type { Dam } from "@/lib/dam";
import { localName } from "@/lib/places";
import { buttonQuiet, card, hint } from "@/lib/ui";

/**
 * The dam's figure on the home screen (the owner's choice of 12 Oct: everyone in Yala, Pattani
 * and Narathiwat sees it, Songkhla does not - see `showsDamFigure` for why).
 *
 * It is deliberately not the quiet notice: nothing here says water is coming. It says where the
 * dam is, what it is doing, and that these are the dam's own published figures and not an alert
 * from Jaga (safety rule 2). Its button opens the dam's whole report - the figures, the fortnight
 * of charts and the river - on the map, the same one the map's own legend opens (owner, 13 Oct).
 * Someone on the river gets the notice instead **while
 * the dam has something to say**; on an ordinary day the notice is silent, so they get this card
 * too, with `onRiver` so the sentence beneath the drawing tells them the truth about where they
 * live.
 */
export function DamFigureCard({
  dam,
  onRiver = false,
  tambonCode = null,
  tambonName = null,
}: {
  dam: Dam;
  onRiver?: boolean;
  /** Their own tambon when they are on the river: the arrival time is read for that one. */
  tambonCode?: string | null;
  tambonName?: string | null;
}) {
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
      {/*
       * On a quiet day this card is the only thing someone on the river sees, so it carries the
       * hours their own water needs - the same lines the notice would have shown them.
       */}
      {onRiver && tambonCode && dam.arrivals.length > 0 && (
        <DamArrivalLines dam={dam} tambonCodes={[tambonCode]} tambonName={tambonName} />
      )}
      <p className={hint}>{t("disclaimer.notAnAlert")}</p>
      {/*
       * The dam's code travels in the address, so the map arrives with the report already open
       * instead of asking someone to find a mark a few pixels wide (the fault of 12 Oct).
       */}
      <Link
        href={{ pathname: "/map", query: { dam: dam.code } }}
        prefetch={false}
        className={`${buttonQuiet} self-start`}
      >
        <WaveIcon size={20} aria-hidden="true" />
        {t("legend.open", { dam: name })}
      </Link>
    </section>
  );
}
