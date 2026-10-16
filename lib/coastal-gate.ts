/**
 * The coastal gate: how much low-water window the sea is leaving a river to drain through
 * (science plan Module 10; the owner asked for it on 16 Oct 2026 after a friend in Narathiwat
 * described the Bang Nara flooding while the sea stood high and the water could not get out).
 *
 * A river drains while the sea is below it, so what keeps water in after the rain stops is the
 * **low** tide, not the high one: the floor the river has to get over. Monsoon set-up lifts that
 * floor and a collapsing tidal range stops it dropping, and in both the 2024 and the 2025 floods
 * the low water at all four mouths stood at the 96th-99th percentile of flood-season days while
 * the high water was unremarkable (pipeline/coastal_gate/report.md).
 *
 * Two rules this file keeps:
 *  - **It is a modifier, never a trigger** (safety rule 2). Nothing here returns a level, nothing
 *    here feeds `suggest()`, and the sea alone floods nothing. What it answers is how long water
 *    will take to leave, which is the safe-return window's question.
 *  - **Only percentiles, never a height** (safety rule 8). The model sat about 0.7 m off the
 *    Pattani tide gauge (A8, 14 Oct 2026) and its cell is a few kilometres offshore, so a day is
 *    only ever compared with the same mouth's own record.
 *
 * Pure: the page reads the reference and the stored tide series, everything here only reads
 * numbers, so it is all testable without a network or a database.
 */

import type { Point } from "./signals";

/** Thailand keeps one offset all year, so a Bangkok day is a fixed shift. */
const BANGKOK_OFFSET_MS = 7 * 3_600_000;
const DAY_MS = 86_400_000;

/** A day needs this many of its 24 hours before its low and high water are read (as in the pipeline). */
export const MIN_HOURS_PER_DAY = 20;
/** Shut days in a row before the gate is called shut: one high day is a tide, several is a gate. */
export const SHUT_DAYS = 2;

export type Percentiles = { p50: number | null; p90: number | null; p98: number | null };

/** One mouth's flood-season record, from `coastal_gate_reference` (seed 49). */
export type GateReference = {
  id: string;
  /** The warning zone this mouth belongs to; null for a mouth with no zone yet (Bang Nara). */
  basin: string | null;
  name: Record<string, string | null>;
  lat: number;
  lon: number;
  /** Daily lower low water: the floor the river drains over. */
  llw: Percentiles;
  /** The non-tidal set-up: what the monsoon adds to the mean. */
  setup: Percentiles;
  seasonDays: number;
  updatedAt: number | null;
};

export type GateDay = {
  /** Start of the Bangkok day, ms since 1970 (UTC). */
  at: number;
  low: number;
  high: number;
  range: number;
  hours: number;
  /** Low water at or over the mouth's p90: the sea is not letting the river out that day. */
  shut: boolean;
  /** At or over p98: the top of the record. */
  hard: boolean;
};

export type GateState = "shut" | "narrowing" | "open" | "unknown";

export type Gate = {
  state: GateState;
  /** Today onward, in order. */
  days: GateDay[];
  /** The longest run of shut days from today on. */
  shutRun: number;
  /** The first day of that run, when there is one. */
  shutFrom: number | null;
  reference: GateReference;
};

const numberOrNull = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

function percentiles(row: Record<string, unknown>, prefix: string): Percentiles {
  return {
    p50: numberOrNull(row[`${prefix}_p50`]),
    p90: numberOrNull(row[`${prefix}_p90`]),
    p98: numberOrNull(row[`${prefix}_p98`]),
  };
}

/** `admin_coastal_gate()` rows. Unreadable rows are dropped rather than guessed at. */
export function toReferences(rows: unknown): GateReference[] {
  if (!Array.isArray(rows)) return [];
  const out: GateReference[] = [];
  for (const raw of rows as Record<string, unknown>[]) {
    const lat = numberOrNull(raw.lat);
    const lon = numberOrNull(raw.lon);
    if (typeof raw.id !== "string" || lat === null || lon === null) continue;
    const updated = typeof raw.updated_at === "string" ? Date.parse(raw.updated_at) : NaN;
    out.push({
      id: raw.id,
      basin: typeof raw.basin === "string" ? raw.basin : null,
      name: (raw.name ?? {}) as Record<string, string | null>,
      lat,
      lon,
      llw: percentiles(raw, "llw"),
      setup: percentiles(raw, "setup"),
      seasonDays: numberOrNull(raw.season_days) ?? 0,
      updatedAt: Number.isFinite(updated) ? updated : null,
    });
  }
  return out;
}

/** Start of the Bangkok day that `at` falls in, as UTC ms. */
export function bangkokDay(at: number): number {
  return Math.floor((at + BANGKOK_OFFSET_MS) / DAY_MS) * DAY_MS - BANGKOK_OFFSET_MS;
}

/**
 * The stored hourly sea level, folded into Bangkok days: the lowest and highest the sea gets each
 * day, and whether that day's low water clears the mouth's p90 line. Days before today and days
 * with too few hours are left out, so a half-written first or last day never reads as a low.
 */
export function gateDays(
  tide: Point[],
  reference: GateReference,
  now: number,
  minHours = MIN_HOURS_PER_DAY,
): GateDay[] {
  const byDay = new Map<number, number[]>();
  for (const [at, value] of tide) {
    if (!Number.isFinite(at) || !Number.isFinite(value)) continue;
    const day = bangkokDay(at);
    const list = byDay.get(day);
    if (list) list.push(value);
    else byDay.set(day, [value]);
  }
  const today = bangkokDay(now);
  const { p90, p98 } = reference.llw;
  return [...byDay.entries()]
    .filter(([day, values]) => day >= today && values.length >= minHours)
    .sort((a, b) => a[0] - b[0])
    .map(([at, values]) => {
      const low = Math.min(...values);
      const high = Math.max(...values);
      return {
        at,
        low,
        high,
        range: high - low,
        hours: values.length,
        shut: p90 !== null && low >= p90,
        hard: p98 !== null && low >= p98,
      };
    });
}

/** The longest run of shut days, and the day it starts. */
function longestShutRun(days: GateDay[]): { run: number; from: number | null } {
  let best = 0;
  let bestFrom: number | null = null;
  let run = 0;
  let from: number | null = null;
  for (const day of days) {
    if (day.shut) {
      run += 1;
      from ??= day.at;
      if (run > best) {
        best = run;
        bestFrom = from;
      }
    } else {
      run = 0;
      from = null;
    }
  }
  return { run: best, from: bestFrom };
}

/**
 * What the forecast says the sea will do to this river's drainage.
 *
 *   - `shut`: the low water stays at or over the mouth's p90 for two days running or more. Rain
 *     that falls now will take the slow end of the safe-return window to leave.
 *   - `narrowing`: one such day, or the low water is over the median every day ahead. Worth
 *     watching, not worth saying.
 *   - `open`: the sea is letting the river out normally.
 *   - `unknown`: no reference, or too little of the forecast stored to judge. Never "open": a
 *     missing figure is not good news (safety rule 8).
 */
export function coastalGate(
  tide: Point[],
  reference: GateReference,
  now: number,
  shutDays = SHUT_DAYS,
): Gate {
  const days = gateDays(tide, reference, now);
  const { run, from } = longestShutRun(days);
  const { p50, p90 } = reference.llw;
  const state: GateState =
    p90 === null || days.length === 0
      ? "unknown"
      : run >= shutDays
        ? "shut"
        : run > 0 || (p50 !== null && days.every((d) => d.low >= p50))
          ? "narrowing"
          : "open";
  return { state, days, shutRun: run, shutFrom: from, reference };
}

/**
 * Whether a gauge's safe-return window should be read at its slow end: the gate is shut and the
 * gauge is one the tide reaches. Where a gauge is above the tide's reach its own record already
 * says how it falls back, so the sea adds nothing and this stays false.
 */
export function slowReturn(gate: Gate | null, tidal: boolean): boolean {
  return tidal && gate?.state === "shut";
}
