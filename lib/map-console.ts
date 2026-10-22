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
 * The run of river gauges a press on the rivers' readout walks through, and where it starts.
 *
 * Two rules, in this order, and the second was overruled by the first on 20 Oct 2026:
 *
 *   * **A river at or near its bank comes first, however far away it is.** The owner: "for the
 *     case that there are 3 gauges that says 'near the bank', when clicked it should show the
 *     worst 3 first, regardless they are near or not". The readout is counting all four
 *     provinces, so what it counts is what it opens.
 *   * **Otherwise their own rivers**: the stations within `GAUGES_NEAR_KM` of their area or of
 *     any place they watch - the same distance, and for the same reason, as the live monitoring
 *     uses (lib/monitoring.ts: the gauge feed carries a point and no province, and the
 *     provinces' boxes overlap). This was the whole rule until the sentence above (18 Oct).
 *
 * Distance never decides the pool now; it breaks a tie between two stations reading the same,
 * which is how the riskiest of several of their own places is still the one that opens.
 *
 * The order is total and never random: how it reads, then distance, then the newest reading,
 * then the id. The same readings always give the same run, so a second press cannot land
 * elsewhere and Next cannot wander.
 */
export function gaugeRun<T extends GaugeReading & { id: string }>(
  gauges: readonly T[],
  /** The person's own area and the places they watch. Empty for a visitor who has saved none. */
  places: readonly { lat: number; lon: number }[] = [],
): T[] {
  const near = places.flatMap((place) => gaugesNear(gauges, place));
  const mine = new Set(near.map((g) => g.id));
  const km = (g: T) =>
    places.length === 0
      ? 0
      : Math.min(...places.map((p) => Math.hypot(g.lat - p.lat, (g.lon - p.lon) * SCALE(p.lat))));
  return [...gauges].sort(
    (a, b) =>
      gaugeRank(gaugeLook(a.status), mine.has(a.id)) -
        gaugeRank(gaugeLook(b.status), mine.has(b.id)) ||
      km(a) - km(b) ||
      (b.observedAt ?? "").localeCompare(a.observedAt ?? "") ||
      a.id.localeCompare(b.id),
  );
}

/**
 * Where a station stands in the run. A bank reached or neared is the whole four provinces'
 * business; below that, their own rivers are read before everybody else's.
 */
function gaugeRank(look: GaugeLook, mine: boolean): number {
  if (look === "over") return 0;
  if (look === "near") return 1;
  const rest = { high: 0, normal: 1, nolevels: 2, quiet: 3 }[look] ?? 3;
  return (mine ? 2 : 6) + rest;
}

/** Which station the rivers' readout opens: the first of the run. */
export function gaugeOfInterest<T extends GaugeReading & { id: string }>(
  gauges: readonly T[],
  places: readonly { lat: number; lon: number }[] = [],
): T | null {
  return gaugeRun(gauges, places)[0] ?? null;
}

/**
 * How many marks the map frames and lights at once when a readout is pressed (the owner,
 * 20 Oct 2026: "the map should zoom the extents of the 3 not only one"). Three, because that is
 * what the readout itself counts; past that the frame would be the four provinces again and the
 * reader would be shown nothing in particular.
 */
export const LIT_MAX = 3;

/**
 * The stations a press lights: those at or near their bank, worst first, at most three - and
 * where no river is near its bank, the one station the card opens on, so the press always points
 * at something.
 */
export function gaugesLit<T extends GaugeReading & { id: string }>(run: readonly T[]): T[] {
  const concern = run.filter((g) => {
    const look = gaugeLook(g.status);
    return look === "over" || look === "near";
  });
  return (concern.length > 0 ? concern : run.slice(0, 1)).slice(0, LIT_MAX);
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

/**
 * Where a reservoir stands in the run a press on the dam readout walks through: water going over
 * the spillway first, then a reservoir past the level it is normally held at, then the rest -
 * the same two facts `damAlarm` asks about, so the card and the pulse can never disagree.
 */
function damRank(dam: Dam): number {
  const tally = damTally(dam);
  if (!tally) return 3;
  if ((tally.spilledCms ?? 0) > 0) return 0;
  const { percentFull, normalMark } = tally;
  if (percentFull !== null && normalMark !== null && percentFull / 100 > normalMark) return 1;
  return 2;
}

/**
 * How far gone a reservoir is within its rank: how much water is going over the spillway, or how
 * far past the level it is normally held at. Only ever compared between two reservoirs of the
 * same rank, where the question is the same for both; it says nothing across ranks.
 */
function damSeverity(dam: Dam): number {
  const tally = damTally(dam);
  if (!tally) return 0;
  const spilled = tally.spilledCms ?? 0;
  if (spilled > 0) return spilled;
  const { percentFull, normalMark } = tally;
  if (percentFull !== null && normalMark !== null) return percentFull / 100 - normalMark;
  return 0;
}

/**
 * The reservoirs a press on the dam readout walks through (the owner, 20 Oct 2026: "same should
 * work for the dams card"; 23 Oct 2026, setting the order inside each half).
 *
 *   * **Anything doing something comes first, worst first**: over the spillway before past the
 *     normal level, and within each, the most water or the furthest past it. "If they clicked
 *     the card when there is an abnormal situation for few reservoirs, it should open up the
 *     worst case, and less case next, sort by the criticality."
 *   * **With every reservoir normal, the biggest first**: "for the normal situation for all, it
 *     should bring the largest capacity first, sort by that". The dam the chips and the home
 *     screen mean is no longer put in front by name - it is the largest of the four anyway, and
 *     a quiet day should open the reservoir that holds the most water, whichever that is.
 *
 * A total order, as the gauges' run is, so Next cannot wander and a second press cannot land
 * somewhere else.
 */
export function damRun(dams: readonly Dam[]): Dam[] {
  const size = (d: Dam) => d.storageMaxMcm ?? 0;
  const full = (d: Dam) => d.signal?.percentFull ?? -1;
  return [...dams].sort(
    (a, b) =>
      damRank(a) - damRank(b) ||
      (damRank(a) < 2 ? damSeverity(b) - damSeverity(a) : 0) ||
      size(b) - size(a) ||
      full(b) - full(a) ||
      a.code.localeCompare(b.code),
  );
}

/** The reservoirs a press lights: the ones doing something, at most three, else the first. */
export function damsLit(run: readonly Dam[]): Dam[] {
  const concern = run.filter((d) => damRank(d) < 2);
  return (concern.length > 0 ? concern : run.slice(0, 1)).slice(0, LIT_MAX);
}

export type DamsTally = {
  /** Reservoirs sending water over the spillway. */
  spilling: number;
  /** Reservoirs past the level they are normally held at. */
  aboveNormal: number;
  /** The two together: how many reservoirs are worth a look. */
  watch: number;
  total: number;
  /** The one the readout is titled by: the worst, or the largest when all of them are normal. */
  lead: DamTally | null;
  /**
   * The figure the card shows - the lead's - is a current reading. It is the lead's own feed and
   * not the six together on purpose: the dot sits beside that one figure, and a dot fed by some
   * other reservoir's clock would say "live" about a number that is a day old (safety rule 8).
   */
  live: boolean;
};

/**
 * Every reservoir at once, not only the nearest (the owner, 23 Oct 2026: the readout "should
 * check and say the overall situation of the all reservoir cards"). It is the dam readout's
 * answer to `gaugeTally`, and like that one it only counts: nothing here decides a level, and
 * the count is a measurement, so the card never wears an alert colour (safety rule 2).
 */
export function damsTally(dams: readonly Dam[]): DamsTally {
  const run = damRun(dams);
  const ranks = run.map(damRank);
  const spilling = ranks.filter((r) => r === 0).length;
  const aboveNormal = ranks.filter((r) => r === 1).length;
  const lead = damTally(run[0]);
  return {
    spilling,
    aboveNormal,
    watch: spilling + aboveNormal,
    total: run.length,
    lead,
    live: lead !== null && !lead.stale && lead.observedAt !== null,
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

/**
 * Any reservoir going over its spillway or sitting past the level it is normally held at - all
 * four of them, not just the one the card is titled by (the owner, 23 Oct 2026: "why Dam Card
 * doesn't have pulse like the river gauges?"). The rivers' readout has always counted every
 * station; this one counted one reservoir, so a dam spilling two provinces away asked nobody to
 * look. Plain attention, never an alert colour, exactly as the rivers blink (safety rule 2).
 */
export function damsAlarm(tally: Pick<DamsTally, "watch">): TileAlarm {
  return tally.watch > 0 ? "attention" : null;
}

/** A tambon where several different residents report the same thing. */
export function reportsAlarm(tally: Pick<ReportTally, "confirmed">): TileAlarm {
  return tally.confirmed > 0 ? "attention" : null;
}
