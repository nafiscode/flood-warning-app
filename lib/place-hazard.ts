import type { TambonRisk } from "@/lib/tambon-risk";

/**
 * A whole province or district's share of the flood-hazard classes, summed from its tambons
 * (19 Nov 2026).
 *
 * Why it exists: the fifteen `/flood/<place>` pages were about 285 words each and 77-80% identical
 * to one another - the same template with a different name in it - and Search Console would not
 * index the thinnest of them (`/flood/sadao`, validation failed 14 Nov). The pages needed
 * something true that differs from place to place, and S3 already had it: this is the figure the
 * Flood Risk Map draws and the home screen shows for one tambon. Measured against jaga-dev on
 * 23 Nov 2026, it runs from 30% of buildings on Medium or High land in Bannang Sata to 71% in
 * Mueang Pattani, and all fifteen places have rows.
 *
 * It returns the same shape the home screen's card takes, so the place page reuses that component
 * and its reviewed words - including the eyebrow that says this is the long-term picture and not
 * today's alert, and the note that it is an estimate and not a forecast (safety rules 8 and 10).
 * No new sentence had to be written for it, and none can drift from the home screen's.
 */

/** The columns this needs, as the table spells them (`hazard_by_tambon`). */
export type HazardRow = {
  tambon_code?: unknown;
  land_km2?: unknown;
  high_km2?: unknown;
  medium_km2?: unknown;
  low_km2?: unknown;
  minimal_km2?: unknown;
  buildings?: unknown;
  high_buildings?: unknown;
  medium_buildings?: unknown;
};

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * Sum the rows of a place into one risk figure.
 *
 * **Weighted by area, not an average of the tambons' percentages.** A district holds tambons of
 * very different sizes - Sadao's nine run from a few km² to several hundred - and averaging their
 * percentages would let a tiny tambon count for as much as one fifty times its size, which is how
 * a figure ends up wrong in the direction nobody checks. The same goes for buildings: the share at
 * risk is the count of buildings on Medium or High land over the count of all of them, never the
 * mean of each tambon's share.
 *
 * `code` carries the place's own code (2 or 4 digits), not a tambon's six.
 */
export function aggregatePlaceHazard(code: string, rows: readonly HazardRow[]): TambonRisk | null {
  if (!Array.isArray(rows) || rows.length === 0) return null;

  let high = 0;
  let medium = 0;
  let low = 0;
  let minimal = 0;
  let buildings = 0;
  let atRisk = 0;
  let counted = 0;

  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    counted += 1;
    high += num(row.high_km2);
    medium += num(row.medium_km2);
    low += num(row.low_km2);
    minimal += num(row.minimal_km2);
    buildings += Math.round(num(row.buildings));
    atRisk += Math.round(num(row.high_buildings)) + Math.round(num(row.medium_buildings));
  }
  if (counted === 0) return null;

  /*
   * The four class areas are used as the denominator rather than `land_km2`: they are what the
   * bar draws, and if a later radar run left them summing to slightly less than the land (masked
   * ground, a tambon the run did not reach) a bar built on `land_km2` would not fill, which reads
   * as a sliver of "not stated" that nothing in the data actually says.
   */
  const classed = high + medium + low + minimal;
  const shares =
    classed > 0
      ? {
          high: (high / classed) * 100,
          medium: (medium / classed) * 100,
          low: (low / classed) * 100,
          minimal: (minimal / classed) * 100,
        }
      : // No class area at all is "not stated", never "no risk" (safety rule 10).
        { high: 0, medium: 0, low: 0, minimal: 100 };

  return {
    code,
    land: shares,
    buildings,
    // Null, not zero, where no building was counted: the card then leads on land instead of
    // printing a 0% that would read as an all-clear.
    buildingsAtRisk: buildings > 0 ? Math.min(100, (atRisk / buildings) * 100) : null,
  };
}
