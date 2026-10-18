import { contrastRatio } from "@/lib/brand/contrast";
import { ALERT_LEVELS, brand, darkBrand, type AlertLevel } from "@/lib/brand/tokens";
import type { Dam } from "@/lib/dam";
import type { TambonReports } from "@/lib/flood-reports";
import { gaugeLook, type GaugeLook } from "@/lib/gauge-marks";
import { gaugesNear } from "@/lib/monitoring";
import type { GaugeReading } from "@/lib/map-data";
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

export function gaugeTally(gauges: readonly GaugeReading[]): GaugeTally {
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

/**
 * Which river gauge the readout's own card should open (the owner, 18 Oct 2026: pressing the
 * card should bring up the detail, as a reservoir's does; then: "the nearest of the user's
 * place... if users have multiple watch places, show the riskiest one first").
 *
 * So it is the person's own rivers first: the stations within `GAUGES_NEAR_KM` of their area or
 * of any place they watch - the same distance, and for the same reason, as the live monitoring
 * uses (lib/monitoring.ts: the gauge feed carries a point and no province, and the provinces'
 * boxes overlap). Among those, the riskiest; and where two read the same, the nearer one.
 *
 * Somebody who has saved nowhere, or whose places have no station within that distance, gets the
 * riskiest of all of them rather than nothing - the readout is about all four provinces either
 * way, and it says so.
 *
 * The order is total and never random: risk, then distance, then the newest reading, then the
 * id. The same readings always open the same station, so a second press cannot land elsewhere.
 */
export function gaugeOfInterest<T extends GaugeReading & { id: string }>(
  gauges: readonly T[],
  /** The person's own area and the places they watch. Empty for a visitor who has saved none. */
  places: readonly { lat: number; lon: number }[] = [],
): T | null {
  const rank = (look: GaugeLook) =>
    ({ over: 0, near: 1, normal: 2, nolevels: 3, quiet: 4 })[look] ?? 4;
  const near = places.flatMap((place) => gaugesNear(gauges, place));
  // Theirs if any of their places has one in reach; everybody's otherwise.
  const mine = new Set(near.map((g) => g.id));
  const pool = mine.size > 0 ? gauges.filter((g) => mine.has(g.id)) : gauges;
  const km = (g: T) =>
    places.length === 0
      ? 0
      : Math.min(...places.map((p) => Math.hypot(g.lat - p.lat, (g.lon - p.lon) * SCALE(p.lat))));
  return (
    [...pool].sort(
      (a, b) =>
        rank(gaugeLook(a.status)) - rank(gaugeLook(b.status)) ||
        km(a) - km(b) ||
        (b.observedAt ?? "").localeCompare(a.observedAt ?? "") ||
        a.id.localeCompare(b.id),
    )[0] ?? null
  );
}

/** Longitudes shrink towards the poles; at this latitude the small-angle form is exact enough. */
const SCALE = (lat: number) => Math.cos((lat * Math.PI) / 180);

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
  /** Going over the spillway, m3/s. */
  spilledCms: number | null;
  /** The share of the reservoir it is normally held at, 0-1, or null when it is not published. */
  normalMark: number | null;
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
  const max = dam.storageMaxMcm;
  const normal = dam.storageNormalMcm;
  return {
    dam,
    percentFull: signal?.percentFull ?? null,
    spilledCms: signal?.spilledCms ?? null,
    normalMark: max && normal && max > 0 ? normal / max : null,
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

/*
 * The veil over the weather's sky behind the console (components/map/ConsoleSky.tsx).
 *
 * The console's own words are the theme's ink, not the sky's, so the veil has to carry them: it
 * is worked out here rather than chosen by eye, as the lightest veil that still leaves the
 * weakest text on the console - the secondary grey - at 4.5:1 against both ends of that sky
 * (CLAUDE.md, accessibility). A clear day therefore shows as a real blue sky, and a thunderstorm
 * is held back far enough to read through. If the palette or a sky ever changes, this follows
 * it; a test holds every sky in both themes to the same 4.5:1.
 */

/** The veil's own colour in each theme, the two ends the sky is mixed towards. */
export const VEIL_COLOR = { light: "#FAFCFD", dark: "#09141E" } as const;

/** A little more than the least that passes, so rounding never lands under it. */
const VEIL_MARGIN = 0.04;
const VEIL_MAX = 0.92;

function overlay(veil: string, alpha: number, under: string): string {
  const parts = (hex: string) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  const [vr, vg, vb] = parts(veil);
  const [ur, ug, ub] = parts(under);
  const mix = (a: number, b: number) => Math.round(a * alpha + b * (1 - alpha));
  return `#${[mix(vr!, ur!), mix(vg!, ug!), mix(vb!, ub!)]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("")}`;
}

/** The lightest veil of `veil` that keeps `ink` readable on every colour in `sky`. */
export function veilAlpha(sky: readonly string[], ink: string, veil: string): number {
  for (let step = 25; step <= VEIL_MAX * 100; step += 1) {
    const alpha = step / 100;
    if (sky.every((colour) => contrastRatio(ink, overlay(veil, alpha, colour)) >= 4.5)) {
      return Math.min(VEIL_MAX, Math.round((alpha + VEIL_MARGIN) * 100) / 100);
    }
  }
  return VEIL_MAX;
}

/** The veil for one sky in each theme: the console picks between them by the clock, as it does. */
export function consoleVeil(sky: readonly string[]): { light: number; dark: number } {
  return {
    light: veilAlpha(sky, brand["jaga-text-2"], VEIL_COLOR.light),
    dark: veilAlpha(sky, darkBrand["jaga-text-2"], VEIL_COLOR.dark),
  };
}

/*
 * When a readout asks for an admin's eye (the owner, 16 Oct 2026: the four cards blink for
 * admins on a laptop). It is a nudge, never a level: only the alerts card wears the alert
 * palette, because only it repeats levels an admin published. The river, the dam and residents'
 * reports pulse in a plain colour, because a reading is a measurement and a resident's report is
 * not an alert - neither may be dressed as a level Jaga issued (safety rules 2 and 3; the same
 * reason gauges are drawn in the water colour and not in alert colours).
 *
 * Nothing here decides anything. The card says in words what it says either way; the pulse only
 * asks someone to look, so a reader who cannot see it loses nothing.
 */
export type TileAlarm = AlertLevel | "attention" | null;

/** The worst level in force, when it is one that means act. Watch does not blink. */
export function alertsAlarm(tally: readonly LevelTally[]): TileAlarm {
  for (const level of ["evacuate", "warning"] as const) {
    if (tally.some((x) => x.level === level && x.tambons > 0)) return level;
  }
  return null;
}

/** A river at or over its bank. Near the bank is not enough: it would blink most of a wet week. */
export function gaugeAlarm(tally: Pick<GaugeTally, "over">): TileAlarm {
  return tally.over > 0 ? "attention" : null;
}

/** Water going over the spillway, or a reservoir past the level it is normally held at. */
export function damAlarm(tally: DamTally | null): TileAlarm {
  if (!tally) return null;
  if ((tally.spilledCms ?? 0) > 0) return "attention";
  const { percentFull, normalMark } = tally;
  if (percentFull !== null && normalMark !== null && percentFull / 100 > normalMark) {
    return "attention";
  }
  return null;
}

/** A tambon where several different residents report the same thing. */
export function reportsAlarm(tally: Pick<ReportTally, "confirmed">): TileAlarm {
  return tally.confirmed > 0 ? "attention" : null;
}
