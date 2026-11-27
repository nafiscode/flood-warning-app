"use client";

import { useLocale, useTranslations } from "next-intl";
import { Chip } from "@/components/admin/WarRoomBits";
import { PhoneIcon, PinIcon, TriangleIcon } from "@/components/icons";
import { coordsText, directionsHref, splitMinutes, vulnerableKeys } from "@/lib/dispatch";
import { sortEscalated, type EscalatedCase } from "@/lib/escalated";
import { buttonSecondary, hint } from "@/lib/ui";

/**
 * Requests nobody has taken for 30 minutes, opened to every rescue team (owner, 27 Nov 2026), so
 * a team outside the tambon can reach the person and arrange help outside the app. It amends
 * safety rule 5 for these cases only.
 *
 * Jaga does not assign these to anyone: they are in another team's area, and the screen says so.
 * The point is on the card; the sender's number is one tap away and every look is written to the
 * audit log by the database, which also decides who may be here at all. Nothing is drawn when
 * there is nothing to show.
 */
export function EscalatedCases({
  cases,
  phones,
  busy,
  onPhone,
}: {
  cases: readonly EscalatedCase[];
  /** The numbers already asked for, by case. Null: the sender gave none. */
  phones: Record<string, string | null>;
  busy: string | null;
  onPhone: (sosId: string) => void;
}) {
  const t = useTranslations("authority");
  const tSos = useTranslations("sos");
  const locale = useLocale();
  if (cases.length === 0) return null;

  const waited = (minutes: number) => {
    const { hours, minutes: mins } = splitMinutes(minutes);
    return hours > 0
      ? t("escalated.timeHm", { hours, minutes: mins })
      : t("escalated.timeM", { minutes: mins });
  };

  return (
    <section
      className="flex flex-col gap-3 rounded-2xl border-2 border-sos bg-jaga-surface p-4"
      data-escalated={cases.length}
      aria-labelledby="escalated-title"
    >
      <h2
        id="escalated-title"
        className="flex flex-wrap items-center gap-2 font-bold text-jaga-ink"
      >
        <span className="inline-flex items-center gap-2 rounded-xl bg-sos px-3 py-1 text-sos-fg">
          <TriangleIcon size={20} />
          {t("escalated.badge")}
        </span>
        <span>{t("escalated.title", { count: cases.length })}</span>
      </h2>
      <p className={hint}>{t("escalated.note")}</p>

      <div className="grid gap-3 lg:grid-cols-2">
        {sortEscalated(cases).map((c) => {
          const name = locale === "th" ? c.tambonTh : (c.tambonEn ?? c.tambonTh);
          const place = [name, c.districtTh, c.provinceTh].filter(Boolean).join(" · ");
          const flags = vulnerableKeys(c.vulnerableFlags);
          const phone = c.sosId in phones ? phones[c.sosId] : undefined;
          return (
            <article
              key={c.sosId}
              className="flex flex-col gap-2 rounded-xl border border-jaga-line p-3"
              data-escalated-case={c.sosId}
            >
              <p className="font-bold text-jaga-ink">{place || t("escalated.noArea")}</p>
              <p className="font-medium text-jaga-ink">
                {t("escalated.waited", { time: waited(c.waitingMinutes) })}
              </p>
              {c.locationText && (
                <p className={hint}>{t("escalated.typedPlace", { text: c.locationText })}</p>
              )}
              <div className="flex flex-wrap gap-2">
                {c.peopleCount != null && (
                  <Chip strong>{t("escalated.people", { count: c.peopleCount })}</Chip>
                )}
                {flags.map((k) => (
                  <Chip key={k} strong>
                    {tSos.has(`vulnerable.${k}`)
                      ? tSos(`vulnerable.${k}` as "vulnerable.elderly")
                      : k}
                  </Chip>
                ))}
                {c.onBehalf && <Chip>{t("escalated.onBehalf")}</Chip>}
              </div>
              {c.injuries && (
                <p className="font-medium">{t("escalated.injuries", { text: c.injuries })}</p>
              )}
              {c.note && <p>{t("escalated.said", { text: c.note })}</p>}
              {c.lat != null && c.lon != null && (
                <p className={`${hint} tabular-nums`}>
                  {t("escalated.coords", { coords: coordsText(c.lat, c.lon) })}
                  {c.accuracyM != null
                    ? ` · ${t("escalated.accuracy", { m: Math.round(c.accuracyM) })}`
                    : ""}
                </p>
              )}

              <div className="flex flex-wrap gap-2">
                {c.lat != null && c.lon != null && (
                  <a
                    href={directionsHref(c.lat, c.lon)}
                    target="_blank"
                    rel="noreferrer"
                    className={buttonSecondary}
                  >
                    <PinIcon size={20} />
                    {t("escalated.directions")}
                  </a>
                )}
                {c.hasPhone && phone === undefined && (
                  <button
                    type="button"
                    className={buttonSecondary}
                    disabled={busy === c.sosId}
                    onClick={() => onPhone(c.sosId)}
                  >
                    <PhoneIcon size={20} />
                    {t("escalated.showPhone")}
                  </button>
                )}
              </div>
              {!c.hasPhone && <p className={hint}>{t("escalated.phoneNone")}</p>}
              {phone !== undefined && (
                <div className="flex flex-col gap-1 border-t border-jaga-line pt-2">
                  {phone ? (
                    <a href={`tel:${phone}`} className="min-h-tap text-h3 font-bold underline">
                      {phone}
                    </a>
                  ) : (
                    <p className="font-medium">{t("escalated.phoneNone")}</p>
                  )}
                  <p className={hint}>{t("escalated.phoneLogged")}</p>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
