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

/** A flood report in a team's coverage (spec 5.7). What the water is doing and where; no reporter. */
export type TeamReport = {
  id: string;
  createdAt: string;
  hazard: string;
  lat: number;
  lon: number;
  tambon: string | null;
  tambonNameTh: string | null;
  tambonNameEn: string | null;
  depth: string | null;
  trend: string | null;
  roadAccess: string | null;
  note: string | null;
  photoCount: number;
  hasVoice: boolean;
  /** "pending" until an admin has looked at it; a hidden report never reaches a team. */
  moderation: string;
};

/**
 * A household that asked to be known about before a flood (spec 4.7), as a team with rescue or
 * coordination capability reads it. No phone number: that is one more logged tap.
 */
export type TeamHousehold = {
  id: string;
  tambon: string | null;
  tambonNameTh: string | null;
  tambonNameEn: string | null;
  lat: number;
  lon: number;
  size: number | null;
  vulnerable: Record<string, number>;
  mobilityNotes: string | null;
  hasPhone: boolean;
  /** Registered by a relative for someone at a place they watch. */
  onBehalf: boolean;
  updatedAt: string;
};

/** The vulnerable categories, in the order every screen lists them. */
export const VULNERABLE_ORDER = [
  "elderly",
  "bedridden",
  "infant_child",
  "pregnant",
  "disability",
  "needs_medicine",
  "needs_oxygen",
  "needs_dialysis",
] as const;

/** The categories a household counted at least one person in, in the fixed order. */
export function vulnerableCounts(v: Record<string, number> | null | undefined) {
  return VULNERABLE_ORDER.map((key) => ({ key, count: Number(v?.[key] ?? 0) })).filter(
    (x) => Number.isFinite(x.count) && x.count > 0,
  );
}

/** How many people in a household were counted as vulnerable, for sorting. */
export function vulnerableTotal(v: Record<string, number> | null | undefined): number {
  return vulnerableCounts(v).reduce((sum, x) => sum + x.count, 0);
}

/** Households tambon by tambon; inside one, those with the most vulnerable people first. */
export function householdsByTambon(rows: TeamHousehold[]) {
  const groups = new Map<string, TeamHousehold[]>();
  for (const row of rows) {
    const key = row.tambon ?? "";
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([tambon, list]) => ({
      tambon,
      rows: [...list].sort((a, b) => vulnerableTotal(b.vulnerable) - vulnerableTotal(a.vulnerable)),
    }));
}

/** A resident's own household, as their form reads it back. */
export type MyHousehold = {
  id: string;
  size: number | null;
  vulnerable: Record<string, number>;
  mobilityNotes: string | null;
  contactPhone: string | null;
  lat: number | null;
  lon: number | null;
};

/** What a household form may send for the counts: whole numbers 0 to 20, zeroes dropped. */
export function cleanCounts(input: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of VULNERABLE_ORDER) {
    const n = Math.round(Number(input[key]));
    if (Number.isFinite(n) && n > 0) out[key] = Math.min(n, 20);
  }
  return out;
}

/** One row of the points ledger, as the admins read it (spec 5.5). A revoked row is kept. */
export type PointsAward = {
  id: number;
  createdAt: string;
  unitName: string;
  orgName: string;
  sosId: string | null;
  tambonNameTh: string | null;
  tambonNameEn: string | null;
  points: number;
  reason: string;
  revokedAt: string | null;
  revokeReason: string | null;
};

/** What counts now: the awards nobody has taken back. */
export function livePoints(rows: PointsAward[]): number {
  return rows.filter((r) => !r.revokedAt).reduce((sum, r) => sum + r.points, 0);
}

/** Another team's point of contact, once a team asked for it (spec 5.3). */
export type UnitContact = { name: string | null; phone: string | null };
