"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { TackIcon } from "@/components/icons";
import { LevelCounts } from "@/components/alerts/LevelCounts";
import type { Dam } from "@/lib/dam";
import type { TambonReports } from "@/lib/flood-reports";
import {
  ageMinutes,
  alertsAlarm,
  damsAlarm,
  damsTally,
  gaugeAlarm,
  gaugeTally,
  levelTally,
  reportsAlarm,
  reportTally,
  type TileAlarm,
} from "@/lib/map-console";
import type { DamsTally } from "@/lib/map-console";
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

/**
 * The figure with the live pulse beside it, on the folded card (the owner, 20 Oct 2026: "these 2
 * cards should show the blinking situation light on the default folded card, no need to hover on
 * to see the blinking light"). It used to wait with the rest of the card until somebody rested a
 * pointer on it, which is exactly the glance it is there for.
 *
 * It pulses only while the readings behind it are current. A dot on a feed that has stopped would
 * say "live" about figures that are not, and it says nothing about what the figures mean: a
 * measurement is not a level, and only an admin's alert ever wears one (safety rules 2 and 3).
 */
function LiveFigure({ live, children }: { live: boolean; children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-1.5 text-h3 font-bold leading-tight text-jaga-ink">
      {live && <span className="mt-2">{<LiveDot />}</span>}
      <span className="min-w-0">{children}</span>
    </p>
  );
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
    <svg
      aria-hidden="true"
      data-live-dot="true"
      width="8"
      height="8"
      viewBox="0 0 8 8"
      className="shrink-0"
    >
      <circle cx="4" cy="4" r="4" className={`fill-jaga-teal-ink ${styles.live}`} />
    </svg>
  );
}

const tile =
  "flex min-w-0 flex-col gap-1.5 rounded-xl border border-jaga-line bg-jaga-surface px-4 py-3";

/**
 * One readout, small until it is asked for (the owner, 18 Oct 2026: "by default these cards
 * should only show minimal info... when hover on, it can open larger, and if the user prefers
 * they can pin it"). The aim is more map.
 *
 * Small, a card carries its heading and its figure - never less, because the figure is the thing
 * that is glanced at. Resting the pointer on one (or tabbing into it) opens the rest over the
 * top of the map, which is what the owner chose over pushing the map down: the map never resizes
 * under the pointer. The pin keeps a card open, and then it does take its room in the strip,
 * because a pinned card is meant to stay.
 *
 * The shape of all this is in app/globals.css with the rest of the console, and it is a laptop
 * arrangement only: the whole strip is drawn nowhere else.
 */
function Tile({
  id,
  alarm,
  label,
  brief,
  more,
  pinned,
  onPin,
  pinWords,
  onOpen,
  openLabel,
  children,
}: {
  id: string;
  alarm?: string;
  label: React.ReactNode;
  brief: React.ReactNode;
  /** What waits until the card is opened. Left out, the card has nothing more to show. */
  more?: React.ReactNode;
  pinned: boolean;
  onPin: () => void;
  pinWords: { pin: string; unpin: string };
  /**
   * What the card opens, if it opens anything (the owner, 18 Oct 2026: pressing the rivers and
   * the reservoir "should bring to detail the same like Dam button"). Left out, the card stays
   * what the rest of the strip is: a readout, where a mis-click costs nothing.
   */
  onOpen?: () => void;
  openLabel?: string;
  /** Controls, which stay with the figure: hidden words cannot be reached by a keyboard. */
  children?: React.ReactNode;
}) {
  return (
    <li
      data-console-tile={id}
      data-tile-pinned={pinned ? "true" : "false"}
      className="flex min-w-0 flex-col"
    >
      <div data-tile-card="true" data-console-alarm={alarm} className={`${tile} relative flex-1`}>
        {/*
         * The heading row holds everything that must not move: a control inside a card that
         * grows when it opens would slide out from under the pointer going for it, and a
         * figure that opens pushes whatever is beneath it down.
         */}
        <div data-tile-head="true" className="flex items-start justify-between gap-2">
          <Label>{label}</Label>
          <span className="flex shrink-0 items-center gap-2">
            {children}
            {more && (
              <button
                type="button"
                data-tile-pin="true"
                aria-pressed={pinned}
                onClick={onPin}
                className="-m-1 shrink-0 rounded p-1 text-jaga-text-2 hover:text-jaga-ink"
              >
                <TackIcon size={18} on={pinned} aria-hidden="true" />
                <span className="sr-only">{pinned ? pinWords.unpin : pinWords.pin}</span>
              </button>
            )}
          </span>
        </div>
        <div data-tile-brief="true" className="flex min-w-0 flex-col gap-1.5">
          {brief}
        </div>
        {more && (
          <div data-tile-more="true" className="flex min-w-0 flex-col gap-1.5">
            {more}
          </div>
        )}
        {/*
         * The whole card is the way in, so there is nothing small to aim at - and it is a real
         * button, named for a screen reader, laid over the card rather than wrapped around it,
         * because the pin inside it is a button too and a button cannot hold a button.
         */}
        {onOpen ? (
          <button type="button" data-tile-open="true" onClick={onOpen} className="absolute inset-0">
            <span className="sr-only">{openLabel}</span>
          </button>
        ) : (
          more && (
            /*
             * A card with nothing of its own to open is opened by a tap on it, and stays open
             * until it is tapped again (the owner, 21 Oct 2026, choosing the tablet console).
             * A finger cannot rest on a card, so hover cannot be the only way in; on a laptop
             * this is simply the pin again, under a bigger target.
             */
            <button
              type="button"
              data-tile-toggle="true"
              aria-pressed={pinned}
              onClick={onPin}
              className="absolute inset-0"
            >
              <span className="sr-only">{pinned ? pinWords.unpin : pinWords.pin}</span>
            </button>
          )
        )}
      </div>
    </li>
  );
}

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
  /**
   * Opening what a readout is about (the owner, 18 Oct 2026). Left out, both cards stay
   * readouts. The strip was deliberately readouts only when it was built on 16 Oct - "nothing
   * in it moves the map or switches a layer" - and the owner has since asked for these two.
   */
  onOpenDam?: () => void;
  onOpenGauges?: () => void;
  /**
   * How many reservoirs a press on the dam card will frame and light (the owner, 20 Oct 2026:
   * the card opens everything worth watching, not only the dam it reports). Only the words
   * change here; which reservoirs those are is lib/map-console.ts and the map's own business.
   */
  damLit?: number;
};

export function ConsoleTiles(props: ConsoleTilesProps) {
  const t = useTranslations("map.console");
  const tHome = useTranslations("home");
  /*
   * Which readouts the reader has pinned open. Kept for as long as the page is open and no
   * longer (the owner chose, 18 Oct): every visit starts with the small cards and the most map.
   */
  const [pinned, setPinned] = useState<Record<string, boolean>>({});
  const isPinned = (id: string) => pinned[id] === true;
  const pin = (id: string) => setPinned((was) => ({ ...was, [id]: !was[id] }));
  const tMonitoring = useTranslations("monitoring");
  const { status, alerts, fresh, failed, gauges, reports, time, now } = props;
  const scope = props.scope ?? t("scope.all");
  /*
   * Every reservoir, not one of them (the owner, 23 Oct 2026: the readout "should check and say
   * the overall situation of the all reservoir cards"). The card is titled by the one at the head
   * of the run - the worst, or the largest when all four are normal - and says underneath how
   * many of them are worth a look, exactly as the rivers' readout counts every station.
   */
  const damsNow = damsTally(props.dams);
  const dam = damsNow.lead;

  /*
   * Which cards ask for a look. Worked out for everyone and used only for an admin, so the rule
   * is in one place and a test can read it without a session.
   */
  const levels = status && !(failed && !fresh) ? levelTally(alerts) : [];
  const gaugeFigures0 = gauges && gauges.length > 0 ? gaugeTally(gauges) : null;
  const reportFigures0 = reports && reports.length > 0 ? reportTally(reports) : null;
  const alarm = (which: TileAlarm): string | undefined =>
    props.admin && which ? which : undefined;

  /*
   * Each readout gives what is always shown and what waits until the card is opened. The figure
   * itself is never held back: a card that is small still answers the question it is there for.
   */
  const alertFigures = () => {
    if (!status || (failed && !fresh)) {
      return (
        <>
          <Figure>{t("unknown")}</Figure>
          {/* Why there is no figure stays with the figure, small card or not (safety rule 3). */}
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

  const gaugeFigures = (): { brief: React.ReactNode; more: React.ReactNode } => {
    if (!gauges || gauges.length === 0) {
      return { brief: <Figure>{t("gauges.none")}</Figure>, more: <Foot>{t("scope.all")}</Foot> };
    }
    const g = gaugeTally(gauges);
    const age = ageMinutes(g.newestAt, now);
    return {
      brief: (
        <LiveFigure live={g.reporting > 0}>
          {/* Only what is actually happening: "0 over the bank" is noise on a quiet day. */}
          {g.over > 0 && g.near > 0
            ? t("gauges.high", { over: g.over, near: g.near })
            : g.over > 0
              ? t("gauges.over", { count: g.over })
              : g.near > 0
                ? t("gauges.near", { count: g.near })
                : t("gauges.allBelow")}
        </LiveFigure>
      ),
      more: (
        <Foot>
          <span className="flex items-start gap-1.5">
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
      ),
    };
  };

  const damFigures = (all: DamsTally): { brief: React.ReactNode; more: React.ReactNode } => {
    const d = all.lead;
    if (!d) return { brief: <Figure>{t("dam.unknown")}</Figure>, more: null };
    const age = ageMinutes(d.observedAt, now);
    return {
      brief: (
        <>
          {/* The dot pulses while any reservoir is still sending, not only the one named above. */}
          <LiveFigure live={all.live}>
            {d.percentFull !== null
              ? t("dam.full", { percent: Math.round(d.percentFull) })
              : t("dam.unknown")}
          </LiveFigure>
          {/*
           * How the four of them stand, on the folded card: only what is actually happening,
           * the same way the rivers' readout leaves out "0 over the bank" on a quiet day.
           */}
          <p className="text-small text-jaga-text-2">
            {all.watch > 0
              ? [
                  all.spilling > 0 ? t("dam.spilling", { count: all.spilling }) : null,
                  all.aboveNormal > 0 ? t("dam.aboveNormal", { count: all.aboveNormal }) : null,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : t("dam.allNormal")}
          </p>
        </>
      ),
      more: (
        <Foot>
          {[
            d.outflowCms !== null
              ? t("dam.out", { value: Math.round(d.outflowCms) })
              : t("dam.outUnknown"),
            all.total > 1 ? t("dam.counted", { count: all.total }) : null,
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
      ),
    };
  };

  const reportFigures = (): { brief: React.ReactNode; more: React.ReactNode } => {
    if (!reports || reports.length === 0) {
      return {
        brief: <Figure>{t("reports.none")}</Figure>,
        more: <Foot>{t("reports.window")}</Foot>,
      };
    }
    const r = reportTally(reports);
    return {
      brief: <Figure>{t("reports.count", { reports: r.reports, tambons: r.tambons })}</Figure>,
      more: (
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
      ),
    };
  };

  const gauge = gaugeFigures();
  const damParts = damFigures(damsNow);
  const reportParts = reportFigures();
  const pinWords = { pin: t("pin"), unpin: t("unpin") };

  return (
    <ul
      data-console-tiles="true"
      data-console-readout="true"
      className="hidden console:grid console:grid-cols-2 console:gap-3"
      data-console-count={props.monitoring ? 5 : 4}
    >
      <Tile
        id="alerts"
        alarm={alarm(alertsAlarm(levels))}
        label={t("alerts.label")}
        brief={alertFigures()}
        more={<Foot>{t("scope.areas", { scope })}</Foot>}
        pinned={isPinned("alerts")}
        onPin={() => pin("alerts")}
        pinWords={pinWords}
      />

      <Tile
        id="gauges"
        alarm={alarm(gaugeFigures0 ? gaugeAlarm(gaugeFigures0) : null)}
        label={t("gauges.label")}
        brief={gauge.brief}
        more={gauge.more}
        pinned={isPinned("gauges")}
        onPin={() => pin("gauges")}
        pinWords={pinWords}
        onOpen={gauges && gauges.length > 0 ? props.onOpenGauges : undefined}
        openLabel={t("gauges.open")}
      />

      <Tile
        id="dam"
        alarm={alarm(damsAlarm(damsNow))}
        label={dam ? localName(dam.dam.name, props.locale) : t("dam.label")}
        brief={damParts.brief}
        more={damParts.more}
        pinned={isPinned("dam")}
        onPin={() => pin("dam")}
        pinWords={pinWords}
        onOpen={dam && props.onOpenDam ? props.onOpenDam : undefined}
        openLabel={
          dam
            ? (props.damLit ?? 1) > 1
              ? t("dam.openMany", { count: props.damLit ?? 1 })
              : t("dam.open", { dam: localName(dam.dam.name, props.locale) })
            : undefined
        }
      />

      <Tile
        id="reports"
        alarm={alarm(reportFigures0 ? reportsAlarm(reportFigures0) : null)}
        label={t("reports.label")}
        brief={reportParts.brief}
        more={reportParts.more}
        pinned={isPinned("reports")}
        onPin={() => pin("reports")}
        pinWords={pinWords}
      />

      {/*
       * The fifth readout: the whole of the live monitoring in one line, and the way into the
       * band under the dashboard (the owner, 17 Oct). It is the one tile that is a control, so
       * the way in is a button and says whether the band is open; the other four stay readouts,
       * where a mis-click cannot lose anyone their view. The button stays with the figure
       * whether the card is open or not: a hidden word cannot be reached by a keyboard.
       */}
      {props.monitoring &&
        (() => {
          const live = monitoringStatus(props.monitoring!);
          return (
            <Tile
              id="monitoring"
              label={tMonitoring("title")}
              brief={
                <p className="flex items-start gap-2 text-h3 font-bold leading-tight text-jaga-ink">
                  <span className="mt-1">
                    <MonitoringMark status={live} />
                  </span>
                  <MonitoringHeadline status={live} />
                </p>
              }
              more={
                <Foot>
                  <MonitoringFigures status={live} time={time} />
                </Foot>
              }
              pinned={isPinned("monitoring")}
              onPin={() => pin("monitoring")}
              pinWords={pinWords}
            >
              <button
                type="button"
                data-monitoring-open={props.monitoringOpen ? "true" : "false"}
                aria-expanded={!!props.monitoringOpen}
                aria-controls="monitoring-detail-console"
                onClick={props.onToggleMonitoring}
                className="whitespace-nowrap text-small underline"
              >
                {tMonitoring(props.monitoringOpen ? "hideDetail" : "showDetail")}
              </button>
            </Tile>
          );
        })()}
    </ul>
  );
}
