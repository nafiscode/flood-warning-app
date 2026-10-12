"use client";

import { useLocale, useTranslations } from "next-intl";
import { MediaView } from "@/components/authority/Finish";
import { PhoneIcon, PinIcon, WaveIcon } from "@/components/icons";
import {
  householdsByTambon,
  vulnerableCounts,
  type TeamHousehold,
  type TeamReport,
} from "@/lib/coverage";
import { coordsText, directionsHref, type CaseMedia } from "@/lib/dispatch";
import { card, hint } from "@/lib/ui";

/**
 * What a team reads besides its cases (spec 5.7): the flood reports in its coverage, and the
 * households that asked to be known about before a flood (spec 4.7).
 *
 * The household list is the most sensitive screen in Jaga. It is drawn only for a team the
 * database let through, it says at the top that every opening of it is logged, and it carries no
 * phone number: a number is one tap, one household, and one more line in the access log.
 */

type Loaded<T> = T | "failed" | null;

const act =
  "inline-flex min-h-tap items-center justify-center gap-2 rounded-xl border-2 border-jaga-edge bg-jaga-surface px-3 py-2 text-center font-medium text-jaga-ink active:translate-y-px disabled:opacity-60";

const bangkok = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Bangkok",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const bangkokDay = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Bangkok",
  day: "numeric",
  month: "short",
  year: "numeric",
});

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-lg border border-jaga-edge px-2 py-1 text-small font-bold text-jaga-ink">
      {children}
    </span>
  );
}

type ReportsProps = {
  reports: Loaded<TeamReport[]>;
  /** Photos already asked for in this sitting, by report. */
  media: Record<string, CaseMedia | "failed">;
  onMedia: (reportId: string) => void;
};

export function ReportsView({ reports, media, onMedia }: ReportsProps) {
  const t = useTranslations("authority");
  const tReport = useTranslations("report");
  const locale = useLocale();
  if (!Array.isArray(reports)) {
    return (
      <div data-view="reports">
        <p className={reports === "failed" ? "font-medium" : hint}>
          {reports === "failed" ? t("reports.failed") : t("views.loading")}
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4" data-view="reports">
      <p className={hint}>{t("reports.intro")}</p>
      {reports.length === 0 && <p className="font-medium">{t("reports.none")}</p>}
      {reports.map((r) => {
        const place =
          locale === "th" || !r.tambonNameEn
            ? r.tambonNameTh
            : `${r.tambonNameTh} (${r.tambonNameEn})`;
        const shown = media[r.id] ?? null;
        return (
          <article
            key={r.id}
            data-report={r.id}
            className="flex flex-col gap-3 rounded-2xl border border-jaga-line bg-jaga-surface p-4"
          >
            <div className="flex flex-col gap-1">
              <p className="font-bold text-jaga-ink">{place || t("case.noArea")}</p>
              <p className={hint}>
                {t("reports.sentAt", { time: bangkok.format(new Date(r.createdAt)) })}
                {r.moderation === "pending" ? ` · ${t("reports.unchecked")}` : ""}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {r.depth && (
                <Chip>
                  <WaveIcon size={18} />
                  {tReport(`depths.${r.depth}` as "depths.knee")}
                </Chip>
              )}
              {r.trend && tReport.has(`trends.${r.trend}`) && (
                <Chip>{tReport(`trends.${r.trend}` as "trends.rising")}</Chip>
              )}
              {r.roadAccess && tReport.has(`roads.${r.roadAccess}`) && (
                <Chip>{tReport(`roads.${r.roadAccess}` as "roads.car")}</Chip>
              )}
            </div>
            {r.note && <p>{t("reports.said", { text: r.note })}</p>}
            <div className="grid grid-cols-2 gap-2">
              <a
                href={directionsHref(r.lat, r.lon)}
                target="_blank"
                rel="noreferrer"
                className={act}
              >
                <PinIcon size={20} />
                {t("act.navigate")}
              </a>
              {(r.photoCount > 0 || r.hasVoice) && !shown && (
                <button
                  type="button"
                  onClick={() => onMedia(r.id)}
                  data-report-media="true"
                  className={act}
                >
                  {t("media.open")}
                </button>
              )}
              <p className={`${hint} col-span-2 tabular-nums`}>
                {t("case.coordinates", { coords: coordsText(r.lat, r.lon) })}
              </p>
            </div>
            {shown && <MediaView media={shown} />}
          </article>
        );
      })}
    </div>
  );
}

type HouseholdsProps = {
  households: Loaded<TeamHousehold[]>;
  /** Numbers already asked for in this sitting. A key with null: the household gave none. */
  phones: Record<string, string | null>;
  onPhone: (householdId: string) => void;
};

export function HouseholdsView({ households, phones, onPhone }: HouseholdsProps) {
  const t = useTranslations("authority");
  const tSos = useTranslations("sos");
  const locale = useLocale();
  if (!Array.isArray(households)) {
    return (
      <div data-view="households">
        <p className={households === "failed" ? "font-medium" : hint}>
          {households === "failed" ? t("households.failed") : t("views.loading")}
        </p>
      </div>
    );
  }
  const groups = householdsByTambon(households);
  return (
    <div className="flex flex-col gap-4" data-view="households">
      <section className={card}>
        <p className="font-bold text-jaga-ink">{t("households.purpose")}</p>
        <p className={hint}>{t("households.logged")}</p>
      </section>
      {households.length === 0 && <p className="font-medium">{t("households.none")}</p>}
      {groups.map((group) => {
        const first = group.rows[0]!;
        const name =
          locale === "th" || !first.tambonNameEn
            ? first.tambonNameTh
            : `${first.tambonNameTh} (${first.tambonNameEn})`;
        return (
          <section key={group.tambon} className="flex flex-col gap-3">
            <h2 className="font-bold text-jaga-ink">
              {name || t("case.noArea")}
              {" · "}
              {t("households.count", { count: group.rows.length })}
            </h2>
            {group.rows.map((h) => {
              const counts = vulnerableCounts(h.vulnerable);
              const known = h.id in phones;
              return (
                <article
                  key={h.id}
                  data-household={h.id}
                  className="flex flex-col gap-3 rounded-2xl border border-jaga-line bg-jaga-surface p-4"
                >
                  <div className="flex flex-wrap gap-2">
                    {h.size != null && <Chip>{t("case.people", { count: h.size })}</Chip>}
                    {counts.map((c) => (
                      <Chip key={c.key}>
                        {tSos.has(`vulnerable.${c.key}`)
                          ? tSos(`vulnerable.${c.key}` as "vulnerable.elderly")
                          : c.key}
                        {` ${c.count}`}
                      </Chip>
                    ))}
                  </div>
                  {h.mobilityNotes && <p>{t("households.notes", { text: h.mobilityNotes })}</p>}
                  <p className={hint}>
                    {h.onBehalf ? `${t("households.onBehalf")} · ` : ""}
                    {t("households.updated", { date: bangkokDay.format(new Date(h.updatedAt)) })}
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <a
                      href={directionsHref(h.lat, h.lon)}
                      target="_blank"
                      rel="noreferrer"
                      className={act}
                    >
                      <PinIcon size={20} />
                      {t("act.navigate")}
                    </a>
                    {h.hasPhone && !known && (
                      <button
                        type="button"
                        onClick={() => onPhone(h.id)}
                        data-household-phone="true"
                        className={act}
                      >
                        <PhoneIcon size={20} />
                        {t("act.showPhone")}
                      </button>
                    )}
                    <p className={`${hint} col-span-2 tabular-nums`}>
                      {t("case.coordinates", { coords: coordsText(h.lat, h.lon) })}
                    </p>
                  </div>
                  {!h.hasPhone && <p className={hint}>{t("households.noPhone")}</p>}
                  {known && (
                    <div className="flex flex-col gap-2 border-t border-jaga-line pt-3">
                      {phones[h.id] ? (
                        <a
                          href={`tel:${phones[h.id]}`}
                          className="inline-flex min-h-tap items-center gap-2 text-h3 font-bold underline"
                        >
                          <PhoneIcon size={22} />
                          {phones[h.id]}
                        </a>
                      ) : (
                        <p className="font-medium">{t("households.noPhone")}</p>
                      )}
                      <p className={hint}>{t("act.phoneLogged")}</p>
                    </div>
                  )}
                </article>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
