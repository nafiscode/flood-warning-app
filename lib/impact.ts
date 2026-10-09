/**
 * The impact record (spec section 16): types and the pure arithmetic behind the dashboard.
 *
 * A13 builds the real nightly aggregation; until the first season there is nothing to aggregate,
 * so the admin page is fed by lib/impact-examples.ts. Everything here is pure, so the figures on
 * the screen are decided by tested functions and not by the view.
 *
 * Two rules from the decision of 9 Oct 2026 are enforced by the shape of these types:
 *  - no unit carries a score, a rank or a response time. A unit has the volume of its help, and
 *    the dashboard compares a unit with its own last season, never with another unit.
 *  - no person is named. A unit belongs to an organisation; neither has a contact here.
 */

export type ProvinceCode = "90" | "94" | "95" | "96";

export type Capability = "rescue" | "coordination" | "planning" | "support";

export type ImpactTotals = {
  /** Requests Jaga carried to a team. Never "lives saved": the teams did the rescues. */
  requestsCarried: number;
  teamsThatAccepted: number;
  confirmedRescues: number;
  peopleReached: number;
  /** Cases where someone elderly, bedridden, pregnant, a small child or similar was involved. */
  vulnerableInvolved: number;
};

/** What became of every request. Published beside the good numbers, never instead of them. */
export const OUTCOMES = ["confirmed", "unconfirmed", "cancelled", "noTeam"] as const;
export type Outcome = (typeof OUTCOMES)[number];
export type OutcomeCount = { outcome: Outcome; cases: number };

/** How long until a team accepted. Province-wide bands; never a time per case or per unit. */
export const WAIT_BANDS = ["under1", "to5", "to15", "to60", "over60"] as const;
export type WaitBand = (typeof WAIT_BANDS)[number];
export type WaitCount = { band: WaitBand; cases: number };

export type WeekPoint = { from: string; requests: number; confirmed: number };

export type ProvinceRow = {
  province: ProvinceCode;
  requests: number;
  confirmed: number;
  teams: number;
  /** Usage: devices that opened Jaga in this province over the period (spec 16). */
  openedApp: number;
};

export type UnitImpact = {
  id: string;
  org: string;
  unit: string;
  province: ProvinceCode;
  capabilities: Capability[];
  accepted: number;
  confirmed: number;
  peopleReached: number;
  seasons: number;
  acceptedThisMonth: number;
  confirmedThisMonth: number;
  /** Null for a unit in its first season: there is nothing of its own to compare with. */
  lastSeasonAccepted: number | null;
};

export type CoverageGap = {
  tambon: string;
  name: string;
  district: string;
  province: ProvinceCode;
};

export type ImpactSeason = {
  from: string;
  to: string;
  computedAt: string;
  totals: ImpactTotals;
  outcomes: OutcomeCount[];
  waits: WaitCount[];
  medianAcceptMinutes: number;
  longestAcceptMinutes: number;
  weeks: WeekPoint[];
  provinces: ProvinceRow[];
  units: UnitImpact[];
  gaps: CoverageGap[];
};

/** Rounded percentage; 0 rather than NaN when there is nothing yet. */
export function percent(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((100 * part) / whole);
}

/**
 * Bar length as a percentage of the longest bar. A value above zero never draws as nothing:
 * a tambon with one request must still be visible beside one with ninety.
 */
export function barPercent(value: number, max: number): number {
  if (max <= 0 || value <= 0) return 0;
  return Math.max(2, Math.round((100 * value) / max));
}

export function maxOf(values: number[]): number {
  return values.reduce((a, b) => (b > a ? b : a), 0);
}

export function sumBy<T>(rows: T[], pick: (row: T) => number): number {
  return rows.reduce((total, row) => total + pick(row), 0);
}

/**
 * Milestones a unit can reach. Deliberately all "arrival" milestones: a unit either has reached
 * one or has not reached it yet, and the dashboard only ever shows what was reached plus the
 * next one to aim at. There is no milestone for being fast, because a team that is far away
 * cannot be fast and should not be made to look worse for saying so.
 */
export type MilestoneMetric = "accepted" | "confirmed" | "peopleReached" | "seasons";
export type Milestone = { key: string; metric: MilestoneMetric; target: number };

export const MILESTONES: Milestone[] = [
  { key: "firstAccepted", metric: "accepted", target: 1 },
  { key: "firstRescue", metric: "confirmed", target: 1 },
  { key: "accepted10", metric: "accepted", target: 10 },
  { key: "people50", metric: "peopleReached", target: 50 },
  { key: "accepted25", metric: "accepted", target: 25 },
  { key: "rescues25", metric: "confirmed", target: 25 },
  { key: "accepted50", metric: "accepted", target: 50 },
  { key: "people100", metric: "peopleReached", target: 100 },
  { key: "seasons2", metric: "seasons", target: 2 },
  { key: "seasons3", metric: "seasons", target: 3 },
];

export function metricValue(unit: UnitImpact, metric: MilestoneMetric): number {
  if (metric === "accepted") return unit.accepted;
  if (metric === "confirmed") return unit.confirmed;
  if (metric === "peopleReached") return unit.peopleReached;
  return unit.seasons;
}

/** The milestones this unit has reached, in the order they were listed. */
export function earnedMilestones(unit: UnitImpact): Milestone[] {
  return MILESTONES.filter((m) => metricValue(unit, m.metric) >= m.target);
}

export type NextStep = { milestone: Milestone; current: number; remaining: number };

/**
 * The nearest milestone still to reach, measured by how few are missing. "Three more people
 * reached" is an invitation; a table position is not.
 *
 * Seasons are left out of the aiming, though they still count as earned badges: a season is not
 * something a team can go and earn, it arrives by turning up again next year. Without this, "one
 * more season" (a year away) would be offered as the nearest step ahead of "three more cases".
 */
export function nextMilestone(unit: UnitImpact): NextStep | null {
  let best: NextStep | null = null;
  for (const milestone of MILESTONES) {
    if (milestone.metric === "seasons") continue;
    const current = metricValue(unit, milestone.metric);
    if (current >= milestone.target) continue;
    const remaining = milestone.target - current;
    if (!best || remaining < best.remaining) best = { milestone, current, remaining };
  }
  return best;
}

/**
 * The teams to thank this month: those that confirmed a rescue, most first, ties settled by
 * name so the order is never arbitrary. A top, never a bottom - the list simply ends.
 */
export function honours(units: UnitImpact[], limit = 3): UnitImpact[] {
  return units
    .filter((u) => u.confirmedThisMonth > 0)
    .sort(
      (a, b) =>
        b.confirmedThisMonth - a.confirmedThisMonth ||
        b.acceptedThisMonth - a.acceptedThisMonth ||
        a.org.localeCompare(b.org) ||
        a.unit.localeCompare(b.unit),
    )
    .slice(0, limit);
}

/** Units grouped by province, each group in name order. No ranking anywhere. */
export function byProvince(units: UnitImpact[]): { province: ProvinceCode; units: UnitImpact[] }[] {
  const groups = new Map<ProvinceCode, UnitImpact[]>();
  for (const unit of units) {
    const list = groups.get(unit.province);
    if (list) list.push(unit);
    else groups.set(unit.province, [unit]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([province, list]) => ({
      province,
      units: [...list].sort((a, b) => a.org.localeCompare(b.org) || a.unit.localeCompare(b.unit)),
    }));
}

export type SeasonChange = { delta: number; percent: number };

/** A unit against its own last season. Null in a unit's first season. */
export function seasonChange(unit: UnitImpact): SeasonChange | null {
  if (unit.lastSeasonAccepted === null) return null;
  const delta = unit.accepted - unit.lastSeasonAccepted;
  return { delta, percent: percent(Math.abs(delta), Math.max(1, unit.lastSeasonAccepted)) };
}

/** The share of carried requests that ended in a rescue the team confirmed. */
export function confirmedShare(totals: ImpactTotals): number {
  return percent(totals.confirmedRescues, totals.requestsCarried);
}

/** Cases that no team accepted, as a share. Shown next to the headline, by decision. */
export function unansweredShare(outcomes: OutcomeCount[]): number {
  const total = sumBy(outcomes, (o) => o.cases);
  const none = outcomes.find((o) => o.outcome === "noTeam")?.cases ?? 0;
  return percent(none, total);
}
