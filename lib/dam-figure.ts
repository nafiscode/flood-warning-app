/**
 * The dam, turned into the handful of numbers a drawing can move with (the owner's request of
 * 12 Oct: an animated figure of the dam's situation for the home screen; the labelled version of
 * 18 Oct, which puts the storage, the level and both flows on the drawing itself).
 *
 * Everything a figure animates comes from the operator's own published figures, and nothing here
 * invents one:
 *
 *   * **How full** is the storage against the dam's maximum capacity, with the capacity at normal
 *     high water marked, because that is the line an operator works to.
 *   * **How fast** is the outflow against the biggest release in the record. Water leaving through
 *     the powerhouse and water leaving over the spillway are drawn apart, because the dam
 *     publishes them apart and they mean different things to anyone downstream.
 *   * **How quickly the drawing moves** follows the flow, so a quiet dam drifts and a release
 *     runs. Motion is the one channel that cannot be read by someone who is not looking, so every
 *     figure also carries its state in a word and its figures in numbers.
 *
 * A dam that has published nothing gets `level: "unknown"` and **no motion at all**: a still grey
 * drawing says "no figures" far better than a lively one (safety rule 10).
 *
 * The readings come from lib/dam-readout.ts, the same helpers the report's instrument panel uses,
 * so the drawing and the panel can never show different figures for the same hour - including the
 * fallback to the newest figure of the day, which is how Bang Lang's feed arrives on many hours.
 */

import { damLevel, flow, type Dam, type DamLevel, type DamSignal } from "@/lib/dam";
import { flowNow, fullnessOf, storageNow } from "@/lib/dam-readout";

/**
 * The reference marks, from pipeline/dam_release/METHODS.md: the 99th percentile of outflow
 * without a spill measured 160.2 m3/s (the turbines), and the January 2021 release peaked near
 * 800 m3/s in total, which is the largest in fifteen years of the archive.
 *
 * They mirror `system_settings.dam_grades`, which the app does not read; a figure that needs them
 * to be exact rather than indicative should be given them by /api/public/dam instead.
 */
export const TURBINE_MAX_CMS = 160;
export const RECORD_OUTFLOW_CMS = 800;

export type DamFigure = {
  level: DamLevel;
  /** 0-1 of the dam's maximum capacity, or null when storage has not been published. */
  fullness: number | null;
  /** The same share as a percentage, as published, **not** clamped: Jan 2021 passed 100%. */
  percentFull: number | null;
  /** The stored volume itself, in million m³, for the label on the water. */
  storageMcm: number | null;
  /** The reservoir's own level in m MSL, where the operator publishes one. */
  levelM: number | null;
  /** Set when the storage is the newest figure of that day rather than of this hour. */
  storageDay: string | null;
  /** Where the capacity at normal high water sits on that scale, 0-1. */
  normalMark: number | null;
  /** 0-1 of the record release. Clamped: the number itself is always printed beside the figure. */
  flow: number;
  /** Where the turbines' own capacity sits on that scale, 0-1. */
  turbineMark: number;
  outflowCms: number | null;
  /** What is leaving through the turbines, which is the ordinary way out. */
  releasedCms: number | null;
  spilledCms: number | null;
  spilling: boolean;
  /** What is arriving, where the dam publishes it; 0-1 of the record for the arrow. */
  inflowCms: number | null;
  inflowShare: number;
  stale: boolean;
  /** Seconds for one turn of the animation: a quiet dam drifts, a release runs. */
  cycleSeconds: number;
  /** Nothing moves without figures to move it. */
  still: boolean;
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

/** How long one cycle takes, from 7 s at a standstill down to 1.4 s at the record release. */
export function cycleFor(flowShare: number): number {
  return Math.round((7 - 5.6 * clamp01(flowShare)) * 10) / 10;
}

/**
 * What the drawing needs. The fields beyond the signal are optional so a fixture, an example or a
 * future caller can hand over a dam that carries only its figures.
 */
export type FigureSource = Pick<Dam, "signal" | "storageMaxMcm" | "storageNormalMcm"> &
  Partial<Pick<Dam, "days" | "daily" | "feed">>;

export function damFigure(dam: FigureSource): DamFigure {
  const signal: DamSignal | null = dam.signal;
  const level = damLevel(signal);
  // The readout helpers read a whole dam; a figure may be given less than one.
  const whole = {
    ...dam,
    days: dam.days ?? [],
    daily: dam.daily ?? null,
    feed: dam.feed ?? "hourly",
  } as Dam;
  const storage = storageNow(whole);
  const full = fullnessOf(whole, storage);
  const outflow = flowNow(whole, "outflow");
  const inflow = flowNow(whole, "inflow");
  const outflowCms = outflow ? Math.round(outflow.cms * 10) / 10 : null;
  const inflowCms = inflow ? Math.round(inflow.cms * 10) / 10 : null;
  const flowShare = outflowCms === null ? 0 : clamp01(outflowCms / RECORD_OUTFLOW_CMS);
  return {
    level,
    fullness: full ? clamp01(full.ofMax) : null,
    percentFull: full ? full.percentMax : null,
    storageMcm: storage?.mcm ?? null,
    levelM: storage?.levelM ?? null,
    storageDay: storage?.from === "day" ? storage.day : null,
    normalMark: full?.normalMark ?? null,
    flow: flowShare,
    turbineMark: TURBINE_MAX_CMS / RECORD_OUTFLOW_CMS,
    outflowCms,
    releasedCms: signal ? flow(signal.releasedCms) : null,
    spilledCms: signal ? flow(signal.spilledCms) : null,
    spilling: (signal?.spilledCms ?? 0) > 0,
    inflowCms,
    inflowShare: inflowCms === null ? 0 : clamp01(inflowCms / RECORD_OUTFLOW_CMS),
    stale: Boolean(signal?.stale),
    cycleSeconds: cycleFor(flowShare),
    still: level === "unknown",
  };
}

/** The class the figures paint themselves with, one per state (docs/brand.md, 12 Oct). */
export const FIGURE_INK: Record<DamLevel, string> = {
  unknown: "text-alert-stale",
  normal: "text-alert-normal",
  watch: "text-alert-watch",
  releasing: "text-alert-evacuate",
};
