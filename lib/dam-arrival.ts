import type { Dam, DamReachKind } from "@/lib/dam";

/**
 * When released water reaches a place downstream (S7 steps 2-3, measured 12 Oct 2026).
 *
 * Every figure here is a **range in hours after the gates open**, measured at the river gauges -
 * the turbines' daily pulses and the floods since 2020 - and not a hydraulic model. That is why
 * nothing in this file can produce a single time, and why the screens that use it always carry the
 * sentence saying where the range comes from (safety rule 8).
 *
 * `warnFromH` is the earliest with a safety margin already taken off: it is what a warning counts
 * down to, and it is deliberately earlier than the earliest arrival ever measured.
 */
export type DamArrival = {
  tambon: string;
  /** 'main' where the river runs through, 'tributary' where a stream that joins it does. */
  via: DamReachKind;
  kmFromDam: number;
  warnFromH: number;
  earliestH: number;
  latestH: number;
  peakEarliestH: number;
  peakLatestH: number;
  /** The version of the measurement, so a later one can be told from this one. */
  source: string;
};

/**
 * Under an hour is not a range anyone can act on differently: for the two tambons at the dam's own
 * foot the screen says "within the hour" instead of "0.0-0.3 hours".
 */
export const AT_ONCE_H = 1;

/** Beyond two days, hours stop being readable: the peak at Pattani town is 45-90 of them. */
export const DAYS_FROM_H = 48;

/**
 * The arrival for someone's own places: the **nearest to the dam**, because that is where their
 * water comes first. Someone watching a place in Yala and another in Pattani is warned on Yala's
 * clock, not on the later one.
 */
export function arrivalFor(dam: Dam, tambonCodes: readonly string[]): DamArrival | null {
  if (tambonCodes.length === 0) return null;
  const mine = (dam.arrivals ?? []).filter((a) => tambonCodes.includes(a.tambon));
  if (mine.length === 0) return null;
  return mine.reduce((best, a) => (a.kmFromDam < best.kmFromDam ? a : best));
}

/** The whole path, for a reader with no place of their own: first rise, nearest to furthest. */
export function arrivalSpan(dam: Dam): { fromH: number; toH: number } | null {
  const all = dam.arrivals ?? [];
  if (all.length === 0) return null;
  return {
    fromH: Math.min(...all.map((a) => a.warnFromH)),
    toH: Math.max(...all.map((a) => a.latestH)),
  };
}

export type Span = { unit: "hours" | "days"; from: number; to: number };

/** Hours, nearest half under two of them and nearest whole above; days past two days. */
export function spanOf(fromH: number, toH: number): Span {
  if (toH >= DAYS_FROM_H) {
    return { unit: "days", from: half(fromH / 24), to: half(toH / 24) };
  }
  const round = (h: number) => (h < 2 ? half(h) : Math.round(h));
  return { unit: "hours", from: round(fromH), to: round(toH) };
}

function half(value: number): number {
  return Math.round(value * 2) / 2;
}

/** True where the range is too short to be worth printing as one (the dam's own two tambons). */
export function arrivesAtOnce(arrival: DamArrival): boolean {
  return arrival.latestH < AT_ONCE_H;
}

/**
 * The clock window for a release that has actually happened: only ever built from a time a person
 * entered when sending the notice, never from the hourly feed, which lags by hours.
 */
export function clockWindow(
  gatesOpenAt: string | number | Date,
  arrival: Pick<DamArrival, "warnFromH" | "latestH">,
): { from: Date; to: Date } | null {
  const start = new Date(gatesOpenAt).getTime();
  if (!Number.isFinite(start)) return null;
  return {
    from: new Date(start + arrival.warnFromH * 3_600_000),
    to: new Date(start + arrival.latestH * 3_600_000),
  };
}
