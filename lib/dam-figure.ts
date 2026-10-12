/**
 * The dam, turned into the handful of numbers a drawing can move with (the owner's request of
 * 12 Oct: an animated figure of the dam's situation for the home screen).
 *
 * Everything a figure animates comes from the operator's own published figures, and nothing here
 * invents one:
 *
 *   * **How full** is the storage against the dam's maximum capacity, with the capacity at normal
 *     high water marked, because that is the line an operator works to.
 *   * **How fast** is the outflow against the biggest release in the record. Below the turbine
 *     mark the water is leaving through the generators; above it, a gate is open.
 *   * **How quickly the drawing moves** follows the flow, so a quiet dam drifts and a release
 *     runs. Motion is the one channel that cannot be read by someone who is not looking, so every
 *     figure also carries its state in a word and its figure in numbers.
 *
 * A dam that has published nothing gets `level: "unknown"` and **no motion at all**: a still grey
 * drawing says "no figures" far better than a lively one (safety rule 10).
 */

import { damLevel, flow, type Dam, type DamLevel, type DamSignal } from "@/lib/dam";

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
  /** Where the capacity at normal high water sits on that scale, 0-1. */
  normalMark: number | null;
  /** 0-1 of the record release. Clamped: the number itself is always printed beside the figure. */
  flow: number;
  /** Where the turbines' own capacity sits on that scale, 0-1. */
  turbineMark: number;
  outflowCms: number | null;
  spilledCms: number | null;
  spilling: boolean;
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

export function damFigure(
  dam: Pick<Dam, "signal" | "storageMaxMcm" | "storageNormalMcm">,
): DamFigure {
  const signal: DamSignal | null = dam.signal;
  const level = damLevel(signal);
  const max = dam.storageMaxMcm ?? 0;
  const fullness =
    signal?.percentFull !== null && signal?.percentFull !== undefined
      ? clamp01(signal.percentFull / 100)
      : signal?.storageMcm != null && max > 0
        ? clamp01(signal.storageMcm / max)
        : null;
  const normalMark =
    dam.storageNormalMcm != null && max > 0 ? clamp01(dam.storageNormalMcm / max) : null;
  const outflowCms = signal ? flow(signal.outflowCms) : null;
  const flowShare = outflowCms === null ? 0 : clamp01(outflowCms / RECORD_OUTFLOW_CMS);
  return {
    level,
    fullness,
    normalMark,
    flow: flowShare,
    turbineMark: TURBINE_MAX_CMS / RECORD_OUTFLOW_CMS,
    outflowCms,
    spilledCms: signal ? flow(signal.spilledCms) : null,
    spilling: (signal?.spilledCms ?? 0) > 0,
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
