import { ALERT_LEVELS, type AlertLevel } from "@/lib/brand/tokens";
import type { Dam } from "@/lib/dam";
import type { TambonReports } from "@/lib/flood-reports";
import { gaugeLook, type GaugeLook } from "@/lib/gauge-marks";
import type { Gauge } from "@/lib/map-data";
import type { PublicAlert } from "@/lib/public-status";

/**
 * The laptop console's readout strip (the owner, 16 Oct 2026): the four figures a GIS or office
 * viewer wants before they read the map - what is in force, where the rivers stand, what the dam
 * is doing, and what residents are reporting.
 *
 * Every figure here is counted from the same public, edge-cached answers the map itself draws
 * (safety rule 6: nothing exact, nothing personal). Nothing in this file decides a level or
 * suggests one: the alert tally only repeats levels an admin published, and the river and dam
 * tallies are measurements, which is why they never carry an alert colour (safety rule 2).
 */

/** Counted worst first, and only levels that mean "act": Normal and Return are not a warning. */
export const CONSOLE_LEVELS: readonly AlertLevel[] = ["evacuate", "warning", "watch"];

export type LevelTally = { level: AlertLevel; tambons: number };

/**
 * How many tambons stand at each level. A tambon named by two alerts counts once, at the level of
 * the newest alert that names it - the same answer `alertForTambon` gives, so the strip can never
 * disagree with the map or with the tambon's own card.
 */
export function levelTally(
  alerts: readonly Pick<PublicAlert, "level" | "tambons">[],
): LevelTally[] {
  const inForce = new Map<string, AlertLevel>();
  for (const alert of alerts) {
    if (!ALERT_LEVELS.includes(alert.level)) continue;
    for (const code of alert.tambons) if (!inForce.has(code)) inForce.set(code, alert.level);
  }
  const levels = [...inForce.values()];
  return CONSOLE_LEVELS.map((level) => ({
    level,
    tambons: levels.filter((l) => l === level).length,
  }));
}

export type GaugeTally = {
  /** At or over its bank. */
  over: number;
  /** Near its bank. */
  near: number;
  /** Reporting, whatever they read. */
  reporting: number;
  /** Silent for six hours or more: counted, never drawn as if it were current. */
  silent: number;
  total: number;
  /** The newest reading of any gauge, ISO, or null while none has one. */
  newestAt: string | null;
};

export function gaugeTally(gauges: readonly Gauge[]): GaugeTally {
  const looks = gauges.map((g): GaugeLook => gaugeLook(g.status));
  const count = (look: GaugeLook) => looks.filter((l) => l === look).length;
  return {
    over: count("over"),
    near: count("near"),
    reporting: gauges.length - count("quiet"),
    silent: count("quiet"),
    total: gauges.length,
    newestAt: gauges.reduce<string | null>(
      (best, g) => (g.observedAt && (!best || g.observedAt > best) ? g.observedAt : best),
      null,
    ),
  };
}

export type ReportTally = {
  reports: number;
  people: number;
  tambons: number;
  /** Tambons where several different residents report the same. */
  confirmed: number;
  latestAt: string | null;
};

/**
 * What residents are reporting. These are the standing reports - a report stands for at most 72
 * hours, or until the area says the water has gone - so the strip says that window rather than
 * inventing a shorter one it cannot count (safety rule 8's habit: never imply more than we know).
 */
export function reportTally(rows: readonly TambonReports[]): ReportTally {
  return {
    reports: rows.reduce((n, r) => n + r.reports, 0),
    people: rows.reduce((n, r) => n + r.people, 0),
    tambons: rows.length,
    confirmed: rows.filter((r) => r.confirmed).length,
    latestAt: rows.reduce<string | null>(
      (best, r) => (r.latestAt && (!best || r.latestAt > best) ? r.latestAt : best),
      null,
    ),
  };
}

export type DamTally = {
  dam: Dam;
  percentFull: number | null;
  /** Everything leaving the dam, m3/s: turbines and spillway together. */
  outflowCms: number | null;
  inflowCms: number | null;
  observedAt: string | null;
  /** The feed has not been updated: the figures are shown with their age, never as current. */
  stale: boolean;
};

/** The dam the strip reports on: the same one the chips and the home screen's tile mean. */
export function damTally(dam: Dam | undefined): DamTally | null {
  if (!dam) return null;
  const signal = dam.signal;
  return {
    dam,
    percentFull: signal?.percentFull ?? null,
    outflowCms: signal?.outflowCms ?? signal?.releasedCms ?? null,
    inflowCms: signal?.inflowCms ?? null,
    observedAt: signal?.observedAt ?? null,
    stale: signal?.stale ?? false,
  };
}

/** How old a reading is, in whole minutes; null when there is no reading or no clock yet. */
export function ageMinutes(iso: string | null, now: number): number | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return null;
  return Math.max(0, Math.floor((now - at) / 60000));
}
