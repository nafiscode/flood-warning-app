/**
 * The seasonal outlook as the public sees it (science plan Module 9; the owner chose to show it,
 * 14 Oct 2026). Odds that the November-to-January season is wetter or drier than usual, never a
 * flood forecast. Every showing says how often such outlooks were right here, that the worst floods
 * come from a few days of rain no one can foresee this far ahead, and that alerts come from people,
 * not from this (safety rules 2, 8 and 10).
 */

export const OUTLOOK_URL = "/api/public/outlook";

export type SeasonLean = "none" | "dry" | "normal" | "wet";
export type PacificPhase = "el_nino" | "la_nina" | "neutral";

export type SeasonOutlook = {
  /** The season, named by the year it starts in (November to January). */
  season: number;
  issued_on: string;
  lean: SeasonLean;
  pacific: PacificPhase | null;
  /** How often the methods used were right before, in percent; null when none was usable. */
  skill_pct: number | null;
  chance_pct: number | null;
};

const LEANS: SeasonLean[] = ["none", "dry", "normal", "wet"];
const PHASES: PacificPhase[] = ["el_nino", "la_nina", "neutral"];

/** The database's answer, checked; null for anything that is not an outlook. */
export function toSeasonOutlook(raw: unknown): SeasonOutlook | null {
  const o = raw as Record<string, unknown> | null;
  if (!o || typeof o !== "object") return null;
  const season = Number(o.season);
  const issued = String(o.issued_on ?? "");
  const lean = o.lean as SeasonLean;
  if (!Number.isInteger(season) || !/^\d{4}-\d{2}-\d{2}$/.test(issued) || !LEANS.includes(lean))
    return null;
  const pct = (v: unknown) => (typeof v === "number" && v >= 0 && v <= 100 ? v : null);
  return {
    season,
    issued_on: issued,
    lean,
    pacific: PHASES.includes(o.pacific as PacificPhase) ? (o.pacific as PacificPhase) : null,
    skill_pct: pct(o.skill_pct),
    chance_pct: pct(o.chance_pct),
  };
}

/**
 * Whether an outlook still speaks for the coming or current season: from its issue until the end
 * of January after the season starts (Bangkok). An old one is not shown as if it were this year's.
 */
export function stillCurrent(o: SeasonOutlook, now: number): boolean {
  const end = Date.UTC(o.season + 1, 1, 1) - 7 * 3600_000; // 1 Feb 00:00 Bangkok
  return now < end;
}

/** "About n times in 10", never more precise than the evidence. */
export function timesInTen(pct: number): number {
  return Math.max(0, Math.min(10, Math.round(pct / 10)));
}
