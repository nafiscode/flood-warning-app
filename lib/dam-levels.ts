/**
 * The reservoirs as the admin console reads them: what each one is doing now, the two shares of
 * capacity it is graded on, and whether the automatic alarm is armed for it (the owner, 27 Oct
 * 2026 - "threshold can adjust later, and can click enable if I want automatic alarm or not").
 *
 * The river gauges have had this since 14 Oct (`admin_set_gauge_levels` and the tick beside each
 * gauge). A reservoir's two figures were set from the laptop and armed by a seed, which left the
 * people who run the app unable to change either; this is the same screen for them.
 *
 * Pure, as the rest of the signals reading is: the database answers `admin_dam_levels()` and this
 * only shapes it, so what a screen shows can be tested without a browser or a database.
 */

import type { DamSignal } from "@/lib/dam";
import { toDamSignal } from "@/lib/dam";

/** One reservoir's row on the console. */
export type DamLevels = {
  code: string;
  name: Record<string, string>;
  operator: string;
  /** 'hourly' for Bang Lang, 'daily' for the five the Royal Irrigation Department publishes. */
  feed: string;
  storageMaxMcm: number | null;
  storageNormalMcm: number | null;
  /**
   * The share of capacity at which the app itself calls the reservoir watchful, and the share at
   * which - still filling - it raises a draft for the admins. Null means that rule is off for this
   * reservoir, and it is graded only on release, inflow and rise, as every dam was before.
   */
  nearFullPct: number | null;
  fullPct: number | null;
  /** Whether a draft from this reservoir may be published by the automatic alarm. */
  auto: boolean;
  autoSetAt: string | null;
  autoSetBy: string | null;
  /** How many tambons its zone would warn. Zero means there is nobody to send a draft to. */
  tambons: number;
  signal: DamSignal | null;
};

const number = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const text = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/** One row of admin_dam_levels() as a DamLevels, or null when it is not one. */
export function toDamLevels(row: Record<string, unknown>): DamLevels | null {
  const code = text(row.code);
  const name = row.name;
  if (!code || !name || typeof name !== "object" || Array.isArray(name)) return null;
  return {
    code,
    name: name as Record<string, string>,
    operator: text(row.operator) ?? "",
    feed: text(row.feed) ?? "daily",
    storageMaxMcm: number(row.storageMaxMcm),
    storageNormalMcm: number(row.storageNormalMcm),
    nearFullPct: number(row.nearFullPct),
    fullPct: number(row.fullPct),
    auto: row.auto === true,
    autoSetAt: text(row.autoSetAt),
    autoSetBy: text(row.autoSetBy),
    tambons: number(row.tambons) ?? 0,
    signal:
      row.signal && typeof row.signal === "object" && !Array.isArray(row.signal)
        ? toDamSignal(row.signal as Record<string, unknown>)
        : null,
  };
}

/** The reservoirs for the console, biggest first, skipping any row the database cannot answer for. */
export function toDamLevelsList(rows: unknown): DamLevels[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    .map(toDamLevels)
    .filter((d): d is DamLevels => d !== null);
}

/**
 * Why a reservoir's rules cannot fire, or null when nothing is in the way. Said in the console
 * rather than left for somebody to work out from an empty box: a reservoir armed with no
 * threshold, or with a threshold and nobody to warn, looks armed and is not.
 */
export function damRuleGap(dam: DamLevels): "noThreshold" | "noZone" | "noReading" | null {
  if (dam.fullPct === null && dam.nearFullPct === null) return "noThreshold";
  if (dam.tambons === 0) return "noZone";
  if (!dam.signal) return "noReading";
  return null;
}

/**
 * The storage a share of capacity comes to, for the console to print beside the percentage: an
 * operator reads million cubic metres, and 95% of 6 Mm³ means nothing until it says 5.7.
 */
export function shareAsMcm(dam: DamLevels, percent: number | null): number | null {
  if (percent === null || dam.storageMaxMcm === null) return null;
  return Math.round(((dam.storageMaxMcm * percent) / 100) * 100) / 100;
}
