import { useFormatter, useLocale, useTranslations } from "next-intl";
import { AlertBadge } from "@/components/alerts/AlertBadge";
import { DrillMark } from "@/components/alerts/DrillMark";
import { LevelCounts } from "@/components/alerts/LevelCounts";
import { StaleMarker } from "@/components/alerts/StaleMarker";
import { Link } from "@/i18n/navigation";
import { isStale, reasonFor, type PublicAlert } from "@/lib/public-status";
import type { PlaceView } from "@/lib/flood-places";
import { buttonPrimary, buttonSecondary, card, errorNotice, hint, notice } from "@/lib/ui";

/**
 * One place's public flood page (A10, 21 Oct 2026): what is in force here, what the rivers read,
 * how many safe places there are, and what a person can do about it. A province or a district -
 * the page is the same, and a district adds its own tambons by name.
 *
 * It is written for somebody who arrived from a search engine rather than from the app, so it
 * assumes nothing: it names the place in words, says what Jaga is, and ends by saying which four
 * provinces are covered and what to call from anywhere else (safety rule 10). It is drawn entirely
 * on the server, so it is also the one screen that works with no JavaScript at all.
 *
 * Three rules shape every branch below.
 *   - Nothing here may read as "no risk". A place with no alert says "no alert has been issued",
 *     never "safe"; a place Jaga cannot read says so and points at the hotlines.
 *   - An alert carries its level, area, issuer, reason, issue time and next-update time, with a
 *     grey stale marker once that time has passed and never a lowered level (safety rule 3).
 *   - A gauge reading is a measurement, never an alert (safety rule 2), and says so in words.
 */

const AT_BANGKOK = {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "Asia/Bangkok",
} as const;

/**
 * Everything safety rule 3 requires of one alert, in the order a reader needs it.
 *
 * `now` is handed in rather than read here, and it is the instant the page prints at the top as
 * "data as of". So every alert on the page is judged stale against the same moment the reader is
 * told the data is from, instead of against whenever each card happened to render.
 */
function AlertCard({ alert, now }: { alert: PublicAlert; now: number }) {
  const t = useTranslations("home");
  const locale = useLocale();
  const format = useFormatter();
  const at = (iso: string) => format.dateTime(new Date(iso), AT_BANGKOK);
  return (
    <li className={card} data-alert-level={alert.level}>
      {/* A drill keeps its level badge, so the words have to say it is a drill - above them. */}
      {alert.drill ? <DrillMark /> : null}
      <div className="flex flex-wrap items-center gap-2">
        <AlertBadge level={alert.level} />
        {/* A marker beside the level, never instead of it. */}
        {isStale(alert, now) ? <StaleMarker since={new Date(alert.nextUpdateAt)} /> : null}
      </div>
      <dl className="flex flex-col gap-2 text-small">
        <div>
          <dt className="font-medium">{t("reason")}</dt>
          {/* The reviewed template's reason in the reader's language, never a live translation. */}
          <dd>{reasonFor(alert, locale)}</dd>
        </div>
        <div>
          <dt className="font-medium">{t("issuedBy")}</dt>
          {/* The automated alarm is never described as an admin's decision (safety rule 2). */}
          <dd>{alert.auto ? t("issuerAuto") : t("issuer")}</dd>
        </div>
        <div>
          <dt className="font-medium">{t("issued")}</dt>
          <dd>{at(alert.issuedAt)}</dd>
        </div>
        <div>
          <dt className="font-medium">{t("nextUpdate")}</dt>
          <dd>{at(alert.nextUpdateAt)}</dd>
        </div>
        {alert.source ? (
          <div>
            <dt className="font-medium">{t("source")}</dt>
            <dd>{alert.source}</dd>
          </div>
        ) : null}
      </dl>
    </li>
  );
}

type Props = {
  view: PlaceView;
  /** This place's name as the page says it: "จ.ปัตตานี", or "อ.หาดใหญ่ จ.สงขลา". */
  name: string;
  /** The province this place sits in, named, for the list of its other districts. */
  province: { name: string; slug: string } | null;
  /** The other pages to offer at the foot: slug and name, already in the reader's language. */
  siblings: { slug: string; name: string }[];
};

export function FloodPlace({ view, name, province, siblings }: Props) {
  const t = useTranslations("province");
  const tHome = useTranslations("home");
  const tGauge = useTranslations("map.gauge");
  const format = useFormatter();
  const { status, alerts, tally, summary, kind } = view;
  /** "Data as of" is at most 60 s old by construction, so the hour alone is unambiguous. */
  const clock = (iso: string) =>
    format.dateTime(new Date(iso), {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone: "Asia/Bangkok",
    });
  /*
   * A gauge reading is dated, unlike on the map. A reading may be up to six hours old, so "23:00"
   * on a page opened after midnight is a different day and a reader cannot tell which - the map
   * can use the bare hour because somebody is watching it live, and a page found by a search is
   * read whenever.
   */
  const dated = (iso: string) => format.dateTime(new Date(iso), AT_BANGKOK);

  return (
    <article className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-h2 font-bold text-jaga-ink">{t("title", { place: name })}</h1>
        <p className={hint}>{t("lead", { place: name })}</p>
        {status ? <p className={hint}>{t("asOf", { time: clock(status.generatedAt) })}</p> : null}
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-h3 font-bold text-jaga-ink">{t("levels.title")}</h2>
        {!status ? (
          // Could not be read. Never an empty list, which would read as "nothing in force".
          <p className={errorNotice}>{t("unavailable")}</p>
        ) : !status.inService ? (
          /*
           * Before launch nobody is issuing alerts here, and that is not the same as calm. The
           * wording is the home screen's own, so the two can never drift apart.
           */
          <div className={notice}>
            <p className="font-bold text-jaga-ink">{tHome("notInService.title")}</p>
            <p className="text-small">{tHome("notInService.body")}</p>
            <p className="text-small font-medium">{tHome("notInService.emergency")}</p>
          </div>
        ) : alerts.length === 0 ? (
          <div className={notice}>
            <p>{t("levels.none", { place: name })}</p>
            <p className={hint}>{t("levels.normalNote")}</p>
          </div>
        ) : (
          <>
            <LevelCounts tally={tally} />
            {summary ? (
              <p className={hint}>
                {t("levels.tambons", {
                  count: tally.reduce((sum, level) => sum + level.tambons, 0),
                  total: summary.tambons,
                })}
              </p>
            ) : null}
            <ul className="flex flex-col gap-3">
              {alerts.map((alert) => (
                <AlertCard key={alert.id} alert={alert} now={Date.parse(status.generatedAt)} />
              ))}
            </ul>
            <p className={hint}>{t("levels.normalNote")}</p>
          </>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-h3 font-bold text-jaga-ink">{t("gauges.title", { place: name })}</h2>
        {/* Said before the numbers, not after them (safety rule 2). */}
        <p className={hint}>{t("gauges.lead")}</p>
        {!summary ? (
          <p className={errorNotice}>{t("gauges.unavailable")}</p>
        ) : summary.gauges.length === 0 ? (
          <p className={notice}>{t("gauges.none", { place: name })}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {summary.gauges.map((gauge) => (
              <li
                key={gauge.code}
                className="flex flex-col gap-1 rounded-xl border border-jaga-line px-4 py-3"
                data-gauge-status={gauge.status}
              >
                <p className="font-medium text-jaga-ink">{gauge.name.th ?? gauge.code}</p>
                <p className="text-small">{tGauge(gauge.status)}</p>
                {gauge.value !== null ? (
                  <p className="text-small text-jaga-text-2">
                    {tGauge("level", { value: gauge.value })}
                    {gauge.observedAt ? ` · ${tGauge("at", { time: dated(gauge.observedAt) })}` : ""}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/*
        A district's own tambons, by name. This is the most useful block on a district page and the
        one thing on it that is nowhere else: somebody looking for Hat Yai is usually looking for
        one part of Hat Yai, and the name they would search for is in this list. A province's list
        would run past a hundred, so it has none.
      */}
      {kind === "district" && summary?.tambonList?.length ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-h3 font-bold text-jaga-ink">{t("tambons.title", { place: name })}</h2>
          <p className={hint}>{t("tambons.count", { count: summary.tambonList.length })}</p>
          <ul className="flex flex-wrap gap-x-3 gap-y-1">
            {summary.tambonList.map((tambon) => (
              <li key={tambon.code} className="text-small">
                {tambon.nameTh}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-h3 font-bold text-jaga-ink">{t("places.title", { place: name })}</h2>
        {summary ? (
          <>
            <p>{t("places.total", { count: summary.places.total })}</p>
            {/* None checked yet is a real and useful fact here: it tells somebody to ring ahead. */}
            <p className={hint}>
              {summary.places.verified > 0
                ? t("places.checked", { count: summary.places.verified })
                : t("places.unchecked")}
            </p>
          </>
        ) : null}
        <Link href="/map" prefetch={false} className={buttonSecondary}>
          {t("places.link")}
        </Link>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-h3 font-bold text-jaga-ink">{t("act.title")}</h2>
        {/* Asking for help first, and never behind anything (safety rule 1). */}
        <Link href="/sos" prefetch={false} className={buttonPrimary}>
          {t("act.sos")}
        </Link>
        <Link href="/" prefetch={false} className={buttonSecondary}>
          {t("act.home")}
        </Link>
        <Link href="/report" prefetch={false} className={buttonSecondary}>
          {t("act.report")}
        </Link>
        <Link href="/map" prefetch={false} className={buttonSecondary}>
          {t("act.map")}
        </Link>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-h3 font-bold text-jaga-ink">
          {kind === "district" && province
            ? t("inProvince", { province: province.name })
            : t("others")}
        </h2>
        <ul className="flex flex-wrap gap-x-4 gap-y-2">
          {/* A district points back up at its province first, then across at its neighbours. */}
          {(kind === "district" && province ? [province, ...siblings] : siblings).map((other) => (
            <li key={other.slug}>
              <Link
                href={`/flood/${other.slug}`}
                prefetch={false}
                className="inline-flex min-h-tap items-center underline"
              >
                {other.name}
              </Link>
            </li>
          ))}
        </ul>
        {/* The last word on the page: which four, and what to call from anywhere else. */}
        <p className={hint}>{t("coverage")}</p>
      </section>
    </article>
  );
}
