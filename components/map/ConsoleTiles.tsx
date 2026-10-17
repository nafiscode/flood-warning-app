"use client";

import { useTranslations } from "next-intl";
import { LevelCounts } from "@/components/alerts/LevelCounts";
import type { Dam } from "@/lib/dam";
import type { TambonReports } from "@/lib/flood-reports";
import {
  ageMinutes,
  alertsAlarm,
  damAlarm,
  damTally,
  gaugeAlarm,
  gaugeTally,
  levelTally,
  reportsAlarm,
  reportTally,
  type TileAlarm,
} from "@/lib/map-console";
import type { DamTally } from "@/lib/map-console";
import type { Gauge } from "@/lib/map-data";
import { localName } from "@/lib/places";
import {
  MonitoringFigures,
  MonitoringHeadline,
  MonitoringMark,
} from "@/components/monitoring/MonitoringStatus";
import { monitoringStatus, type Monitoring } from "@/lib/monitoring";
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
  /**
   * The person reading is an admin. Only then does a card pulse for attention (the owner,
   * 16 Oct): everyone else sees the same figures, still. It changes what is shown and nothing
   * else - what anyone may read is held by the database's own rules (safety rule 5).
   */
  admin?: boolean;
  /**
   * The live monitoring, as the fifth readout (the owner, 17 Oct 2026: one more card, the status
   * in text with a small moving mark, and the detail in a band under the dashboard rather than
   * in the left rail). Left out, the fifth tile is not drawn.
   */
  monitoring?: Monitoring | null;
  monitoringOpen?: boolean;
  onToggleMonitoring?: () => void;
};

export function ConsoleTiles(props: ConsoleTilesProps) {
  const t = useTranslations("map.console");
  const tHome = useTranslations("home");
  const tMonitoring = useTranslations("monitoring");
  const { status, alerts, fresh, failed, gauges, reports, time, now } = props;
  const scope = props.scope ?? t("scope.all");
  /*
   * The dam the strip reports on: the one with a reading, else the first. The chips and the home
   * screen mean the largest dam with a mapped path; here a reading is what matters, because a
   * tile with nothing in it tells a reader nothing.
   */
  const dam = damTally(props.dams.find((d) => d.signal) ?? props.dams[0]);

  /*
   * Which cards ask for a look. Worked out for everyone and used only for an admin, so the rule
   * is in one place and a test can read it without a session.
   */
  const levels = status && !(failed && !fresh) ? levelTally(alerts) : [];
  const gaugeFigures0 = gauges && gauges.length > 0 ? gaugeTally(gauges) : null;
  const reportFigures0 = reports && reports.length > 0 ? reportTally(reports) : null;
  const alarm = (which: TileAlarm): string | undefined =>
    props.admin && which ? which : undefined;

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
    // Drawn by LevelCounts, which the summary above the map shares, so the two cannot disagree.
    return <LevelCounts tally={tally} />;
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
      data-console-count={props.monitoring ? 5 : 4}
    >
      <li
        className={tile}
        data-console-tile="alerts"
        data-console-alarm={alarm(alertsAlarm(levels))}
      >
        <Label>{t("alerts.label")}</Label>
        {alertFigures()}
        <Foot>{t("scope.areas", { scope })}</Foot>
      </li>

      <li
        className={tile}
        data-console-tile="gauges"
        data-console-alarm={alarm(gaugeFigures0 ? gaugeAlarm(gaugeFigures0) : null)}
      >
        <Label>{t("gauges.label")}</Label>
        {gaugeFigures()}
      </li>

      <li className={tile} data-console-tile="dam" data-console-alarm={alarm(damAlarm(dam))}>
        <Label>{dam ? localName(dam.dam.name, props.locale) : t("dam.label")}</Label>
        {damFigures(dam)}
      </li>

      <li
        className={tile}
        data-console-tile="reports"
        data-console-alarm={alarm(reportFigures0 ? reportsAlarm(reportFigures0) : null)}
      >
        <Label>{t("reports.label")}</Label>
        {reportFigures()}
      </li>

      {/*
       * The fifth readout: the whole of the live monitoring in one line, and the way into the
       * band under the dashboard (the owner, 17 Oct). It is the one tile that is a control, so
       * it is a button and says whether the band is open; the other four stay readouts, where a
       * mis-click cannot lose anyone their view.
       */}
      {props.monitoring && (
        <li className={tile} data-console-tile="monitoring">
          <Label>{tMonitoring("title")}</Label>
          {(() => {
            const status = monitoringStatus(props.monitoring!);
            return (
              <>
                <p className="flex items-start gap-2 text-h3 font-bold leading-tight text-jaga-ink">
                  <span className="mt-1">
                    <MonitoringMark status={status} />
                  </span>
                  <MonitoringHeadline status={status} />
                </p>
                <Foot>
                  <MonitoringFigures status={status} time={time} />
                </Foot>
              </>
            );
          })()}
          <button
            type="button"
            data-monitoring-open={props.monitoringOpen ? "true" : "false"}
            aria-expanded={!!props.monitoringOpen}
            aria-controls="monitoring-detail-map"
            onClick={props.onToggleMonitoring}
            className="min-h-tap self-start text-start underline"
          >
            {tMonitoring(props.monitoringOpen ? "hideDetail" : "showDetail")}
          </button>
        </li>
      )}
    </ul>
  );
}
