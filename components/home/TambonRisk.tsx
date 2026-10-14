"use client";

import { useTranslations } from "next-intl";
import { FeatureIcon } from "@/components/map/FeatureIcon";
import { Link } from "@/i18n/navigation";
import { focusHref } from "@/lib/map-focus";
import { riskHeadline, roundShare, TAMBON_RISK_URL, type TambonRisk } from "@/lib/tambon-risk";
import { useFetched } from "@/lib/use-public";
import styles from "./TambonRisk.module.css";

const SEGMENTS = ["high", "medium", "low", "minimal"] as const;

/**
 * The flood risk of the person's own tambon, on the home screen (the owner, 15 Oct: years of
 * radar and terrain work should reach people who never open the map). The share of its land in
 * each class as one bar, the share of its buildings on Medium or High land in words, and a way
 * into the map. Said plainly to be the long-term picture, not today's alert or a forecast; the
 * colours are the map's pinks, never an alert colour, and each is named in words beside it.
 */
export function TambonRiskView({ risk, name }: { risk: TambonRisk; name: string }) {
  const t = useTranslations("tambonRisk");
  const headline = riskHeadline(risk);
  return (
    <section
      aria-labelledby="tambon-risk-title"
      data-tambon-risk={risk.code}
      data-headline={headline}
      className="flex flex-col gap-3 rounded-xl border-2 border-jaga-line bg-jaga-surface p-4"
    >
      <div className="flex items-start gap-3">
        <FeatureIcon feature="risk" size={36} />
        <div className="flex flex-col">
          <p className="text-small font-medium text-jaga-text-2">{t("eyebrow")}</p>
          <h2 id="tambon-risk-title" className="font-bold text-jaga-ink">
            {t("title", { name })}
          </h2>
        </div>
      </div>

      <p className="text-h3 font-bold leading-snug text-jaga-ink" data-risk-headline>
        {headline === "buildings"
          ? t("headline.buildings", { share: roundShare(risk.buildingsAtRisk ?? 0) })
          : headline === "land"
            ? t("headline.land", { share: roundShare(risk.land.high + risk.land.medium) })
            : t("headline.little")}
      </p>

      <div
        role="img"
        aria-label={t("barLabel", {
          high: roundShare(risk.land.high),
          medium: roundShare(risk.land.medium),
          low: roundShare(risk.land.low),
        })}
        className="flex h-4 w-full overflow-hidden rounded-full"
      >
        {SEGMENTS.map((key) =>
          risk.land[key] > 0 ? (
            <span
              key={key}
              data-segment={key}
              className={`${styles[key]} ${key === "minimal" ? "" : styles.grow} h-full`}
              style={{ width: `${risk.land[key]}%` }}
            />
          ) : null,
        )}
      </div>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-1 text-small sm:grid-cols-4">
        {/* A class the tambon has none of is left out: "High 0%" beside "Not marked 99%" could
            read as an all-clear, which the map never says (safety rule 10). */}
        {SEGMENTS.filter((key) => risk.land[key] > 0).map((key) => (
          <li key={key} className="flex items-center gap-1.5">
            <span aria-hidden="true" className={`${styles[key]} size-3 shrink-0 rounded-sm`} />
            <span>
              {t(`class.${key}`)} <b>{roundShare(risk.land[key])}%</b>
            </span>
          </li>
        ))}
      </ul>

      <p className="text-small text-jaga-text-2">{t("note")}</p>
      <Link
        href={focusHref("risk")}
        prefetch={false}
        data-tambon-risk-map="true"
        className="inline-flex min-h-tap items-center justify-center gap-2 rounded-xl border-2 border-jaga-edge px-4 font-bold text-jaga-ink"
      >
        {t("open")}
        <span aria-hidden="true">→</span>
      </Link>
    </section>
  );
}

/** The card for one tambon, read when the home screen is open; nothing at all while it loads. */
export function TambonRiskCard({ code, name }: { code: string; name: string }) {
  const { data } = useFetched<{ risk: TambonRisk | null }>(
    /^\d{6}$/.test(code) ? `${TAMBON_RISK_URL}?code=${code}` : null,
  );
  if (!data?.risk) return null;
  return <TambonRiskView risk={data.risk} name={name} />;
}
