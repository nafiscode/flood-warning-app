/**
 * The responsibility map (spec 5.6) and the points board (5.5), as the console reads them.
 * Pure types and arithmetic, so a browser component and a test can both use them. No phone
 * number and no person's name is in any of these shapes.
 */

export type CoverageRow = {
  tambon: string;
  nameTh: string;
  nameEn: string;
  province: string;
  /** Verified teams with the rescue capability covering this tambon. */
  rescueUnits: number;
  /** Verified coordinators covering it that are not rescue teams themselves. */
  coordinationUnits: number;
  /** One of the caller's own verified teams covers it. */
  mine: boolean;
};

export type CoverageUnit = {
  id: string;
  name: string;
  orgName: string;
  capabilities: string[];
  onDuty: boolean;
  mine: boolean;
};

export type PointsRow = {
  province: string;
  unitId: string;
  unitName: string;
  orgName: string;
  points: number;
  cases: number;
  mine: boolean;
};

/** The provinces Jaga covers, in the order they are always listed (DOPA codes). */
export const PROVINCES = ["90", "94", "95", "96"] as const;

/** A gap is a tambon no verified rescue team covers, whatever coordinators it has (spec 5.6). */
export function isGap(row: CoverageRow): boolean {
  return row.rescueUnits === 0;
}

export type CoverageTotals = { tambons: number; covered: number; gaps: number; mine: number };

export function coverageTotals(rows: CoverageRow[]): CoverageTotals {
  const gaps = rows.filter(isGap).length;
  return {
    tambons: rows.length,
    covered: rows.length - gaps,
    gaps,
    mine: rows.filter((r) => r.mine).length,
  };
}

/** The gaps, province by province in the fixed order, each list sorted by code. */
export function gapsByProvince(rows: CoverageRow[]): { province: string; rows: CoverageRow[] }[] {
  const order = [...PROVINCES, ...new Set(rows.map((r) => r.province))].filter(
    (p, i, all) => all.indexOf(p) === i,
  );
  return order
    .map((province) => ({
      province,
      rows: rows
        .filter((r) => r.province === province && isGap(r))
        .sort((a, b) => a.tambon.localeCompare(b.tambon)),
    }))
    .filter((group) => group.rows.length > 0);
}

/** The points board, province by province; inside one, most points first. */
export function pointsByProvince(rows: PointsRow[]): { province: string; rows: PointsRow[] }[] {
  const order = [...PROVINCES, ...new Set(rows.map((r) => r.province))].filter(
    (p, i, all) => all.indexOf(p) === i,
  );
  return order
    .map((province) => ({
      province,
      rows: rows
        .filter((r) => r.province === province)
        .sort((a, b) => b.points - a.points || a.unitName.localeCompare(b.unitName)),
    }))
    .filter((group) => group.rows.length > 0);
}

/** What the caller's own teams have earned, over every province. */
export function myPoints(rows: PointsRow[]): { points: number; cases: number } {
  return rows
    .filter((r) => r.mine)
    .reduce((sum, r) => ({ points: sum.points + r.points, cases: sum.cases + r.cases }), {
      points: 0,
      cases: 0,
    });
}

/** A rescue a team reported and nobody has confirmed, on the admins' list (spec 5.4). */
export type UnconfirmedRescue = {
  sosId: string;
  tambonNameTh: string | null;
  tambonNameEn: string | null;
  unitName: string;
  completedAt: string | null;
  proofCount: number;
  peopleCount: number | null;
  /** The person has had their time; an admin may confirm now. */
  due: boolean;
};
