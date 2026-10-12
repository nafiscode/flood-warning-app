"use client";

import { useFormatter, useTranslations } from "next-intl";
import { ClockIcon } from "@/components/icons";
import type { Dam } from "@/lib/dam";
import { arrivalFor, arrivalSpan, arrivesAtOnce, clockWindow, spanOf } from "@/lib/dam-arrival";
import { BANGKOK_DATE_TIME } from "@/lib/time";
import { hint } from "@/lib/ui";

/**
 * When the water reaches **this** place (spec section 15; measured by S7 at the river gauges,
 * 12 Oct 2026). Before this the screens said plainly that nobody knew; they now say a range, and
 * the sentence under it says where the range comes from and what it is not.
 *
 * Three rules hold it honest:
 *
 *   * it is always a range, never a time, and the early end already has a safety margin off it;
 *   * a clock time is shown **only** when a person has said when the gates opened, which happens
 *     when an admin sends the release notice - never from the hourly feed, which lags by hours;
 *   * a place on a side stream is told so, because its water is the main river backing up into
 *     the tributary and the time it is given belongs to the junction, not to its own bank.
 */
export function DamArrivalLines({
  dam,
  tambonCodes,
  tambonName,
  gatesOpenAt = null,
}: {
  dam: Dam;
  /** The person's own tambons: their area and the places they watch. */
  tambonCodes: readonly string[];
  tambonName: string | null;
  /** From a release notice somebody sent; null on an ordinary day. */
  gatesOpenAt?: string | null;
}) {
  const t = useTranslations("dam");
  const format = useFormatter();
  const mine = arrivalFor(dam, tambonCodes);
  const place = tambonName ?? "";

  // Nobody's place, or a dam S7 has not measured: say what the river does as a whole, or nothing.
  if (!mine) {
    const span = arrivalSpan(dam);
    if (!span) return null;
    const s = spanOf(span.fromH, span.toH);
    return (
      <div className="flex flex-col gap-1" data-dam-arrival="span">
        <p>{t(`arrival.span.${s.unit}`, { from: s.from, to: s.to })}</p>
        <p className={hint}>{t("arrival.basis")}</p>
      </div>
    );
  }

  const first = spanOf(mine.warnFromH, mine.latestH);
  const peak = spanOf(mine.peakEarliestH, mine.peakLatestH);
  const window = gatesOpenAt ? clockWindow(gatesOpenAt, mine) : null;
  return (
    <div className="flex flex-col gap-1" data-dam-arrival={mine.via}>
      <p className="flex items-center gap-2 font-medium text-jaga-ink">
        <ClockIcon size={20} aria-hidden="true" />
        {t("arrival.title")}
      </p>
      {window ? (
        <p className="font-medium">
          {t("arrival.windowAt", {
            tambon: place,
            from: format.dateTime(window.from, BANGKOK_DATE_TIME),
            to: format.dateTime(window.to, BANGKOK_DATE_TIME),
          })}
        </p>
      ) : arrivesAtOnce(mine) ? (
        <p>{t("arrival.atOnce", { tambon: place })}</p>
      ) : (
        <p>{t(`arrival.first.${first.unit}`, { tambon: place, from: first.from, to: first.to })}</p>
      )}
      <p>{t(`arrival.peak.${peak.unit}`, { from: peak.from, to: peak.to })}</p>
      {mine.via === "tributary" && <p>{t("arrival.tributary")}</p>}
      <p className={hint}>{t("arrival.basis")}</p>
    </div>
  );
}
