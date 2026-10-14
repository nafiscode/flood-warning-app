/**
 * One tambon's share of the flood-risk classes, for the home screen's card (the owner, 15 Oct:
 * the science should reach people who never open the map). From the table the pipeline writes
 * (`hazard_by_tambon`, S3): how much of the tambon's land lies in each class, and how many of its
 * buildings. The same estimate the Flood Risk Map draws: not a forecast and not an alert.
 *
 * A tambon is never given one class. A card says how much of it is in each, and the share of its
 * buildings on Medium or High land, which is what a person living there can relate to.
 */

export const TAMBON_RISK_URL = "/api/public/tambon-risk";

export type TambonRisk = {
  code: string;
  /** Percent of the tambon's land in each class; `minimal` is the land the map leaves uncoloured. */
  land: { high: number; medium: number; low: number; minimal: number };
  /** Percent of the tambon's buildings on Medium or High land; null where it has none counted. */
  buildingsAtRisk: number | null;
  buildings: number;
};

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** A database row into the card's shape; null for anything that is not a row of the table. */
export function toTambonRisk(row: unknown): TambonRisk | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  if (typeof r.tambon_code !== "string" || !/^\d{6}$/.test(r.tambon_code)) return null;
  const raw = {
    high: Math.max(0, num(r.high_pct)),
    medium: Math.max(0, num(r.medium_pct)),
    low: Math.max(0, num(r.low_pct)),
    minimal: Math.max(0, num(r.minimal_pct)),
  };
  // The four shares come rounded from the table; scaled so a bar drawn from them fills exactly.
  const total = raw.high + raw.medium + raw.low + raw.minimal;
  const land =
    total > 0
      ? {
          high: (raw.high / total) * 100,
          medium: (raw.medium / total) * 100,
          low: (raw.low / total) * 100,
          minimal: (raw.minimal / total) * 100,
        }
      : { high: 0, medium: 0, low: 0, minimal: 100 };
  const buildings = Math.max(0, Math.round(num(r.buildings)));
  const share = r.buildings_medium_or_high_pct;
  return {
    code: r.tambon_code,
    land,
    buildings,
    buildingsAtRisk:
      buildings > 0 && share !== null && share !== undefined
        ? Math.min(100, Math.max(0, num(share)))
        : null,
  };
}

/**
 * Which sentence leads the card. "little" when almost nothing in the tambon is coloured: the card
 * then says so and that it is not the same as no risk (safety rule 10), and never shows a figure
 * that could read as an all-clear.
 */
export function riskHeadline(risk: TambonRisk): "buildings" | "land" | "little" {
  const marked = risk.land.high + risk.land.medium;
  if (marked < 2 && (risk.buildingsAtRisk ?? 0) < 2) return "little";
  return risk.buildingsAtRisk !== null ? "buildings" : "land";
}

/** A share as people say it: whole numbers, "under 1" rather than a bare 0 when there is some. */
export function roundShare(pct: number): string {
  if (pct > 0 && pct < 1) return "<1";
  return String(Math.round(pct));
}
