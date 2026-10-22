import { useFormatter, useLocale, useTranslations } from "next-intl";
import { AlertBadge } from "@/components/alerts/AlertBadge";
import { DrillMark } from "@/components/alerts/DrillMark";
import { LevelCounts } from "@/components/alerts/LevelCounts";
import { StaleMarker } from "@/components/alerts/StaleMarker";
import { LivePulse } from "@/components/flood/LivePulse";
import { PlaceGaugeGlyph } from "@/components/flood/PlaceGaugeGlyph";
import { DropIcon, MapIcon, MessageIcon, PinIcon, WaveIcon } from "@/components/icons";
import { Link } from "@/i18n/navigation";
import { gaugeLook, trendOf, type Trend } from "@/lib/gauge-marks";
import {
  gaugeFacts,
  isLiveGauge,
  orderGauges,
  type PlaceGauge,
  type PlaceView,
} from "@/lib/flood-places";
import { localName } from "@/lib/places";
import { isStale, reasonFor, type PublicAlert } from "@/lib/public-status";
import {
  buttonPrimary,
  buttonQuiet,
  buttonSecondary,
  card,
  errorNotice,
  hint,
  notice,
  offerCard,
} from "@/lib/ui";
import styles from "./FloodPlace.module.css";

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
 *
 * It is also the first page many people will ever see of Jaga (the owner, 23 Oct 2026: "where most
 * people find Jaga by search"), so it is made to be worth staying on: a live strip and three
 * figures at the top, every river gauge as a card with its glass, its rise or fall and its margin
 * to the bank, the river nearest its bank first, and a plain list of what the map adds. The slow
 * teal pulse beside a figure means the reading is current - it is on every gauge that has
 * reported in the last six hours and on none that has not - and it never means a level.
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

const TREND_PATH: Record<Trend, string> = {
  up: "M12 19V5M5 12l7-7 7 7",
  down: "M12 5v14M5 12l7 7 7-7",
  flat: "M5 12h14",
};

/** A rise or fall as an arrow, always beside the words that say it. Ink, never an alert colour. */
function TrendMark({ trend }: { trend: Trend }) {
  return (
    <svg
      aria-hidden="true"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
      data-gauge-trend-mark={trend}
    >
      <path d={TREND_PATH[trend]} />
    </svg>
  );
}

/**
 * One river gauge: its glass, its name, how it stands against its own levels, the reading with
 * its time, how far from the bank it is, and whether it has risen or fallen in the last three
 * hours. The pulse sits beside the name only while the reading is current.
 */
function GaugeCard({
  gauge,
  index,
  dated,
}: {
  gauge: PlaceGauge;
  index: number;
  dated: (iso: string) => string;
}) {
  const t = useTranslations("map.gauge");
  const locale = useLocale();
  const look = gaugeLook(gauge.status);
  const live = isLiveGauge(gauge);
  const trend = trendOf(gauge.rise3h ?? null, look);
  return (
    <li
      className={`${styles.rise} flex items-start gap-3 rounded-xl border border-jaga-line bg-jaga-surface px-4 py-3`}
      style={{ "--i": index } as React.CSSProperties}
      data-gauge-status={gauge.status}
      data-gauge-live={live}
    >
      <PlaceGaugeGlyph look={look} uid={gauge.code || String(index)} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <p className="font-bold text-jaga-ink">{localName(gauge.name, locale) || gauge.code}</p>
          {live ? (
            <span className="inline-flex items-center gap-1.5 text-small font-medium text-jaga-teal-ink">
              <LivePulse />
              {t("live")}
            </span>
          ) : null}
        </div>
        <p className="font-medium">{t(gauge.status)}</p>
        {gauge.value !== null ? (
          <p className="text-small text-jaga-text-2">
            {t("level", { value: gauge.value })}
            {gauge.observedAt ? ` · ${t("at", { time: dated(gauge.observedAt) })}` : ""}
          </p>
        ) : null}
        {live && gauge.value !== null && gauge.bank !== null ? (
          <p className="text-small">
            {gauge.value >= gauge.bank
              ? t("overBank", { value: (gauge.value - gauge.bank).toFixed(2) })
              : t("belowBank", { value: (gauge.bank - gauge.value).toFixed(2) })}
          </p>
        ) : null}
        {live && gauge.rise3h != null ? (
          <p className="flex items-center gap-1.5 text-small" data-gauge-trend={trend}>
            <TrendMark trend={trend} />
            {t(`rise.${trend}`, { value: Math.abs(gauge.rise3h).toFixed(2) })}
          </p>
        ) : null}
      </div>
    </li>
  );
}

/** One of the three figures under the title. */
function Stat({
  value,
  label,
  index,
}: {
  value: string | number;
  label: string;
  index: number;
}) {
  return (
    <li
      className={`${styles.rise} flex min-w-0 flex-col gap-0.5 rounded-xl border border-jaga-line bg-jaga-surface px-3 py-3`}
      style={{ "--i": index } as React.CSSProperties}
    >
      <span className="text-h2 font-bold leading-none text-jaga-ink">{value}</span>
      <span className="text-small text-jaga-text-2">{label}</span>
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
  const format = useFormatter();
  const { status, alerts, tally, summary, kind } = view;
  const facts = summary ? gaugeFacts(summary.gauges) : null;
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
        {/*
          The live strip: how many gauges are reporting, and the newest reading's time. Shown only
          when at least one reading is current, so it can never describe a feed that has stopped.
        */}
        {facts && facts.reporting > 0 && facts.latest ? (
          <p
            className="inline-flex items-center gap-2 self-start rounded-full border border-jaga-teal-ink bg-jaga-teal-ink/10 px-3 py-1.5 text-small font-medium text-jaga-ink"
            data-place-live="true"
          >
            <LivePulse />
            {t("live.now", { count: facts.reporting, time: clock(facts.latest) })}
          </p>
        ) : null}
        {status ? <p className={hint}>{t("asOf", { time: clock(status.generatedAt) })}</p> : null}
      </header>

      {summary ? (
        <ul className="grid grid-cols-3 gap-2" data-place-stats="true">
          <Stat
            index={0}
            value={t("stats.ratio", { count: facts?.reporting ?? 0, total: summary.gauges.length })}
            label={t("stats.gauges")}
          />
          <Stat index={1} value={summary.tambons} label={t("stats.tambons")} />
          <Stat index={2} value={summary.places.total} label={t("stats.places")} />
        </ul>
      ) : null}

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
          <>
            {/* Only what is above zero is said: a zero here would read as calm (safety rule 10). */}
            {facts && (facts.overBank > 0 || facts.nearBank > 0 || facts.rising > 0) ? (
              <ul className="flex flex-wrap gap-2" data-gauge-facts="true">
                {facts.overBank > 0 ? (
                  <li className="rounded-full border-2 border-jaga-edge px-3 py-1 text-small font-medium text-jaga-ink">
                    {t("gauges.facts.over", { count: facts.overBank })}
                  </li>
                ) : null}
                {facts.nearBank > 0 ? (
                  <li className="rounded-full border-2 border-jaga-edge px-3 py-1 text-small font-medium text-jaga-ink">
                    {t("gauges.facts.near", { count: facts.nearBank })}
                  </li>
                ) : null}
                {facts.rising > 0 ? (
                  <li className="rounded-full border border-jaga-line px-3 py-1 text-small text-jaga-ink">
                    {t("gauges.facts.rising", { count: facts.rising })}
                  </li>
                ) : null}
              </ul>
            ) : null}
            <ul className="flex flex-col gap-2">
              {orderGauges(summary.gauges).map((gauge, index) => (
                <GaugeCard key={gauge.code} gauge={gauge} index={index} dated={dated} />
              ))}
            </ul>
          </>
        )}
      </section>

      {/*
        What the map adds. Each line is something the map really draws, in plain words, so a person
        who came for one number learns there is more and has one obvious thing to press.
      */}
      <section className={offerCard} data-place-more="true">
        <h2 className="text-h3 font-bold text-jaga-ink">{t("more.title")}</h2>
        <p className={hint}>{t("more.lead")}</p>
        <ul className="flex flex-col gap-2">
          {(
            [
              [WaveIcon, "gauges"],
              [MapIcon, "hazard"],
              [MessageIcon, "reports"],
              [PinIcon, "places"],
              [DropIcon, "dam"],
            ] as const
          ).map(([Icon, key]) => (
            <li key={key} className="flex items-start gap-3">
              <Icon size={22} className="mt-0.5 shrink-0 text-jaga-teal-ink" />
              <span>{t(`more.items.${key}`)}</span>
            </li>
          ))}
        </ul>
        <Link href="/map" prefetch={false} className={`${buttonQuiet} justify-center`}>
          <MapIcon size={22} />
          {t("more.cta")}
        </Link>
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
