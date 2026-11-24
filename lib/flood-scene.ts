/**
 * When a river has reached its bank, the moment is shown as a scene: the real channel at that
 * gauge, with the live reading rising against the station's own banks and spilling over the lower
 * one (the owner, 24 Nov 2026 - "once that happen it should be like cinematic but using the real
 * geographical information for that scene").
 *
 * Everything the scene draws is measured: the channel comes from `riverSection` (ThaiWater's
 * station record plus the width OpenStreetMap has mapped - lib/gauge-section.ts), and the water's
 * height is the gauge's latest reading. Nothing is modelled and nothing is forecast. A reading at
 * or over the bank is a **measurement**, never an alert on its own: only a human, or the automated
 * alarm on a gauge an admin has ticked, publishes an alert (safety rules 2 and 8). The scene says
 * so in words wherever it is shown.
 *
 * This module is the pure part: whether a gauge is over its bank, and by how much. It reads the
 * same `Gauge` the cross-section does, so the picture and the sentence can never disagree.
 */
import { riverSection } from "@/lib/gauge-section";
import type { Gauge } from "@/lib/map-data";

/** What the scene needs to know about a gauge; `Gauge` already carries all of it. */
export type SceneGauge = Gauge;

/** A gauge is drawable live only when it has spoken recently and has a reading to stand water at. */
export function sceneIsLive(gauge: Pick<Gauge, "status" | "value">): boolean {
  return gauge.status !== "no_recent_data" && typeof gauge.value === "number";
}

/**
 * How far the newest reading stands over the bank the river leaves first, in metres, or null when
 * it is not over any bank (or the station is quiet, or has no bank to measure against). The bank
 * is the lower of the two where the station lists both, exactly as `riverSection` draws it - the
 * side the water really spreads across first.
 *
 * Rounded to the centimetre, because the reading itself is. A stale or silent gauge returns null:
 * a dead sensor's last figure must never open a flood scene (safety rule 10; the 22 Nov 2026
 * frozen-sensor bug).
 */
export function overBankMetres(gauge: SceneGauge): number | null {
  if (!sceneIsLive(gauge) || gauge.value === null || gauge.value === undefined) return null;
  const section = riverSection(gauge);
  if (section.bankMetres === null) return null;
  const over = gauge.value - section.bankMetres;
  return over >= 0 ? Math.round(over * 100) / 100 : null;
}

/** Whether the scene can play for this gauge: it is live and its reading is at or over a bank. */
export function canPlayScene(gauge: SceneGauge): boolean {
  return overBankMetres(gauge) !== null;
}

/**
 * The source line for a reading, short and plain. Every gauge Jaga reads comes from ThaiWater's
 * network; a scene names it so the figure on screen carries where it came from (safety rule 3).
 */
export const SCENE_SOURCE = "ThaiWater";
