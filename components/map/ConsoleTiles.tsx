"use client";

import { useTranslations } from "next-intl";
import { AlertBadge } from "@/components/alerts/AlertBadge";
import type { Dam } from "@/lib/dam";
import type { TambonReports } from "@/lib/flood-reports";
import { ageMinutes, damTally, gaugeTally, levelTally, reportTally } from "@/lib/map-console";
import type { DamTally } from "@/lib/map-console";
import type { Gauge } from "@/lib/map-data";
import { localName } from "@/lib/places";
import type { PublicAlert, PublicStatus } from "@/lib/public-status";
import styles from "./FeatureIcon.module.css";

/**
 * The readout strip across the top of the laptop console (the owner, 16 Oct 2026): four figures
 * to take in before the map - what is in force, where the rivers stand, what the dam is doing,
 * and what residents are reporting.
 *
 * It is a readout, not a control: nothing in it moves the map or switches a layer, so a glance
 * costs nothing and a mis-click cannot lose someone their view. Every tile says how old its
 * figures are and how far they reach, because a dashboard that leaves that out invites a reader
 * to treat an old number as a current one (safety rules 3 and 8).
 *
 * The strip is rendered only on the console, so a 360 px screen never pays a pixel for it.
 */

/** A tile's own heading. Uppercased by CSS outside Thai, which has no capital letters. */
function Label({ children }: { children: React.ReactNode }) {
  return (
    <p data-console-label="true" className="text-small font-bold text-jaga-text-2">
      {children}
    </p>
  );
}

/** The figure a tile is about: large, tabular, and never the only carrier of a meaning. */
function Figure({ children }: { children: React.ReactNode }) {
  return <p className="text-h3 font-bold leading-tight text-jaga-ink">{children}</p>;
}

function Foot({ children }: { children: React.ReactNode }) {
  return <p className="mt-auto text-small text-jaga-text-2">{children}</p>;
}

/**
 * A reading's age in words, but only once it is old enough to matter: every tile already writes
 * the time the reading was taken, so the minutes are there to catch an eye, not to repeat it.
 */
const OLD_ENOUGH_MIN = 60;

/** The slow pulse the feature chips already use, for a figure that changes while someone looks. */
function LiveDot() {
  return (
    <svg aria-hidden="true" width="8" height="8" viewBox="0 0 8 8" className="shrink-0">
      <circle cx="4" cy="4" r="4" className={`fill-jaga-teal-ink ${styles.live}`} />
    </svg>
  );
}

const tile =
  "flex min-w-0 flex-col gap-1.5 rounded-xl border border-jaga-line bg-jaga-surface px-4 py-3";

export type ConsoleTilesProps = {
  status: PublicStatus | null;
  /** The alerts of the hazard and province on show, as the page has already narrowed them. */
  alerts: readonly Pick<PublicAlert, "level" | "tambons">[];
  /** False when the alert status is old and nothing kept counts as current. */
  fresh: boolean;
  failed: boolean;
  gauges: readonly Gauge[] | null;
  dams: Dam[];
  reports: readonly TambonReports[] | null;
  /** The province the page is narrowed to, in words, or null for all four. */
  scope: string | null;
  now: number;
  /** Bangkok time of an ISO stamp, written as the rest of the page writes it. */
  time: (iso: string) => string;
  locale: string;
};

export function ConsoleTiles(props: ConsoleTilesProps) {
  const t = useTranslations("map.console");
  const tHome = useTranslations("home");
  const { status, alerts, fresh, failed, gauges, reports, time, now } = props;
  const scope = props.scope ?? t("scope.all");
  /*
   * The dam the strip reports on: the one with a reading, else the first. The chips and the home
   * screen mean the largest dam with a mapped path; here a reading is what matters, because a
   * tile with nothing in it tells a reader nothing.
   */
  const dam = damTally(props.dams.find((d) => d.signal) ?? props.dams[0]);

  const alertFigures = () => {
    if (!status || (failed && !fresh)) {
      return (
        <>
          <Figure>{t("unknown")}</Figure>
          <p className="text-small text-jaga-text-2">{t("alerts.unknownNote")}</p>
        </>
      );
    }
    const tally = levelTally(alerts).filter((x) => x.tambons > 0);
    if (tally.length === 0) {
      return <Figure>{status.inService ? t("alerts.none") : tHome("notInService.title")}</Figure>;
    }
    /*
     * The level is drawn and written as well as coloured - the badge carries its own icon and
     * word (safety rule 3) - so a count never rests on a colour a reader may not see.
     */
    return (
      <ul className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {tally.map(({ level, tambons }) => (
          <li key={level} className="flex items-center gap-1.5" data-console-level={level}>
            <AlertBadge level={level} />
            <span className="text-h3 font-bold text-jaga-ink">{tambons}</span>
          </li>
        ))}
      </ul>
    );
  };

  const gaugeFigures = () => {
    if (!gauges || gauges.length === 0) {
      return (
        <>
          <Figure>{t("gauges.none")}</Figure>
          <Foot>{t("scope.all")}</Foot>
        </>
      );
    }
    const g = gaugeTally(gauges);
    const age = ageMinutes(g.newestAt, now);
    return (
      <>
        <Figure>
          {/* Only what is actually happening: "0 over the bank" is noise on a quiet day. */}
          {g.over > 0 && g.near > 0
            ? t("gauges.high", { over: g.over, near: g.near })
            : g.over > 0
              ? t("gauges.over", { count: g.over })
              : g.near > 0
                ? t("gauges.near", { count: g.near })
                : t("gauges.allBelow")}
        </Figure>
        <Foot>
          <span className="flex items-start gap-1.5">
            <span className="mt-2 shrink-0">
              <LiveDot />
            </span>
            <span>
              {[
                t("gauges.reporting", { count: g.reporting, total: g.total }),
                g.silent > 0 ? t("gauges.silent", { count: g.silent }) : null,
                g.newestAt ? t("newest", { time: time(g.newestAt) }) : null,
                age !== null && age >= OLD_ENOUGH_MIN ? t("age", { minutes: age }) : null,
                t("scope.all"),
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </span>
        </Foot>
      </>
    );
  };

  const damFigures = (d: DamTally | null) => {
    if (!d) return <Figure>{t("dam.unknown")}</Figure>;
    const age = ageMinutes(d.observedAt, now);
    return (
      <>
        <Figure>
          {d.percentFull !== null
            ? t("dam.full", { percent: Math.round(d.percentFull) })
            : t("dam.unknown")}
        </Figure>
        <Foot>
          {[
            d.outflowCms !== null
              ? t("dam.out", { value: Math.round(d.outflowCms) })
              : t("dam.outUnknown"),
            d.observedAt ? t("newest", { time: time(d.observedAt) }) : t("dam.noReading"),
            d.stale
              ? t("dam.stale")
              : age !== null && age >= OLD_ENOUGH_MIN
                ? t("age", { minutes: age })
                : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </Foot>
      </>
    );
  };

  const reportFigures = () => {
    if (!reports || reports.length === 0) {
      return (
        <>
          <Figure>{t("reports.none")}</Figure>
          <Foot>{t("reports.window")}</Foot>
        </>
      );
    }
    const r = reportTally(reports);
    return (
      <>
        <Figure>{t("reports.count", { reports: r.reports, tambons: r.tambons })}</Figure>
        <Foot>
          {[
            t("reports.people", { count: r.people }),
            r.confirmed > 0 ? t("reports.confirmed", { count: r.confirmed }) : null,
            r.latestAt ? t("newest", { time: time(r.latestAt) }) : null,
            t("reports.window"),
          ]
            .filter(Boolean)
            .join(" · ")}
        </Foot>
      </>
    );
  };

  return (
    <ul
      data-console-tiles="true"
      data-console-readout="true"
      className="hidden console:grid console:grid-cols-2 console:gap-3"
    >
      <li className={tile} data-console-tile="alerts">
        <Label>{t("alerts.label")}</Label>
        {alertFigures()}
        <Foot>{t("scope.areas", { scope })}</Foot>
      </li>

      <li className={tile} data-console-tile="gauges">
        <Label>{t("gauges.label")}</Label>
        {gaugeFigures()}
      </li>

      <li className={tile} data-console-tile="dam">
        <Label>{dam ? localName(dam.dam.name, props.locale) : t("dam.label")}</Label>
        {damFigures(dam)}
      </li>

      <li className={tile} data-console-tile="reports">
        <Label>{t("reports.label")}</Label>
        {reportFigures()}
      </li>
    </ul>
  );
}
