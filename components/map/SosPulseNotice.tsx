"use client";

import { useLocale, useTranslations } from "next-intl";
import { PhoneIcon, TriangleIcon } from "@/components/icons";
import { hint } from "@/lib/ui";
import { waitParts, type SosPulseRow } from "@/lib/sos-pulse";

/**
 * Above the map: where a request for rescue is waiting and no team has taken it (owner, 27 Nov
 * 2026). It is the words for what the map's red pulsing outline shows, so the signal is never
 * colour or motion alone, and it works for a reader who never looks at the map.
 *
 * Only the area is named, never the place or the person (safety rule 6). It says "no team yet",
 * never "nobody will come" (safety rule 10), and the two hotlines are one tap away (rule 4).
 */
export function SosPulseNotice({ rows }: { rows: readonly SosPulseRow[] }) {
  const t = useTranslations("map");
  const locale = useLocale();
  if (rows.length === 0) return null;

  const place = (r: SosPulseRow) => {
    const name = locale === "th" ? r.nameTh : r.nameEn || r.nameTh;
    return [name, r.districtTh, r.provinceTh].filter(Boolean).join(" · ");
  };
  const waited = (minutes: number) => {
    const { hours, minutes: mins } = waitParts(minutes);
    if (hours > 0) return t("sosPulse.timeHm", { hours, minutes: mins });
    return mins < 10 ? t("sosPulse.timeNew") : t("sosPulse.timeM", { minutes: mins });
  };

  return (
    <section
      role="status"
      aria-live="polite"
      data-sos-pulse={rows.length}
      className="flex flex-col gap-2 rounded-2xl border-2 border-sos bg-jaga-surface p-4"
    >
      <h2 className="flex flex-wrap items-center gap-2 font-bold text-jaga-ink">
        <span className="inline-flex items-center gap-2 rounded-xl bg-sos px-3 py-1 text-sos-fg">
          <TriangleIcon size={20} />
          {t("sosPulse.badge")}
        </span>
        <span>{t("sosPulse.title")}</span>
      </h2>
      <ul className="flex flex-col gap-1">
        {rows.map((r) => (
          <li key={r.tambon} className="font-medium text-jaga-ink" data-sos-pulse-tambon={r.tambon}>
            {t("sosPulse.line", {
              place: place(r),
              count: r.cases,
              time: waited(r.waitingMinutes),
            })}
          </li>
        ))}
      </ul>
      <p className={hint}>{t("sosPulse.what")}</p>
      <div className="flex flex-wrap gap-2">
        {(["1784", "1669"] as const).map((number) => (
          <a
            key={number}
            href={`tel:${number}`}
            className="inline-flex min-h-tap items-center gap-2 rounded-xl border-2 border-jaga-edge bg-jaga-surface px-4 font-bold text-jaga-ink"
          >
            <PhoneIcon size={20} />
            {t("sosPulse.call", { number })}
          </a>
        ))}
      </div>
    </section>
  );
}
