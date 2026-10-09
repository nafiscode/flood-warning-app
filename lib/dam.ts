/**
 * Bang Lang dam: what the app knows about the dam, the path released water takes, and the
 * figures its operator publishes (spec section 15, docs/science-plan.md Module 7).
 *
 * Everything here is pure, so the rules that decide what a person is shown are tested rather
 * than trusted. Three of those rules matter more than the rest:
 *
 *   * The grade is a named rule, never a probability. Three releases in fifteen years and no
 *     hydraulic model cannot give a calibrated percentage (safety rule 8).
 *   * The app's own notice is the quiet one, and it carries its disclaimer. The loud one is
 *     raised for admins to review and send: code never publishes an alert (safety rule 2).
 *   * There is no arrival time anywhere, because S7 has not measured the travel times yet. The
 *     path says which way the river runs, not when water gets there and not how far it spreads.
 */

export type DamGrade = "quiet" | "watchful" | "releasing";

/** Every rule the database can name, in the order the app lists them. */
export const DAM_REASONS = [
  "spilling",
  "above_turbines",
  "above_normal_high",
  "inflow_high",
  "rising_fast",
] as const;
export type DamReason = (typeof DAM_REASONS)[number];

/** A rule the newest reading alone meets: shown, but not graded on until the next agrees. */
export const DAM_AWAITING = ["release_unconfirmed", "watch_unconfirmed"] as const;
export type DamAwaiting = (typeof DAM_AWAITING)[number];

export type DamSignal = {
  /** The hour the operator published, not the time we read it. */
  observedAt: string;
  fetchedAt: string;
  storageMcm: number | null;
  percentFull: number | null;
  levelM: number | null;
  inflowCms: number | null;
  releasedCms: number | null;
  spilledCms: number | null;
  /** Everything leaving the dam: through the turbines and over the spillway together. */
  outflowCms: number | null;
  riseMcmPerH: number | null;
  riseWindowH: number;
  grade: DamGrade;
  reasons: DamReason[];
  awaiting: DamAwaiting[];
  /** How many readings the grade had to work with. */
  readings: number;
  stale: boolean;
  /** How many readings in a row a rule must hold for before it counts.  */
  confirmedOver: number;
};

export type DamReachKind = "outlet" | "main" | "tributary";

export type DamReach = {
  kind: DamReachKind;
  seq: number;
  name: Record<string, string>;
  kmFromDam: number | null;
  lengthKm: number | null;
  line: { type: "LineString"; coordinates: [number, number][] };
};

export type DamPoint = { type: "Point"; coordinates: [number, number] };

/** A tambon the river runs through. A distance, never a time (see the module text). */
export type DamTambon = { code: string; via: DamReachKind; kmFromDam: number | null };

export type Dam = {
  code: string;
  name: Record<string, string>;
  river: Record<string, string>;
  operator: string;
  point: DamPoint | null;
  spillwayPoint: DamPoint | null;
  /** Head of the mapped outlet channel, roughly the powerhouse tailwater. Approximate. */
  outletPoint: DamPoint | null;
  reservoir: { type: "MultiPolygon"; coordinates: number[][][][] } | null;
  storageMaxMcm: number | null;
  storageNormalMcm: number | null;
  /** Where the lines came from and what they do not say (safety rule 8). */
  geometrySource: string;
  geometryNote: {
    source?: string;
    credit?: string;
    limits_en?: string;
    mapped_tributaries?: number;
    reach_km?: number;
    spillway_channel_mapped?: boolean;
  };
  reaches: DamReach[];
  tambons: DamTambon[];
  signal: DamSignal | null;
};

/** Answer of /api/public/dam. */
export type DamData = { dams: Dam[] };

export const DAM_URL = "/api/public/dam";

/** How old the reading is, in hours. The feed itself lags by hours, so this is always shown. */
export function ageHours(signal: Pick<DamSignal, "observedAt">, now: number): number {
  return (now - new Date(signal.observedAt).getTime()) / 3_600_000;
}

/**
 * What the app shows of its own accord.
 *
 * "watch" is the quiet notice of the owner's decision on 10 Oct: a line on the screen with its
 * disclaimer, no sound and no notification. "releasing" shows the same quiet notice with firmer
 * wording - it does **not** become an alert, because the alarm is a person's to send.
 *
 * A reading that meets a rule only once gets "awaiting": the figure is shown and said to be
 * waiting for the next reading. Hiding it would be dishonest; grading on it would wake people
 * for the archive's impossible hours.
 */
export type DamAttention = "none" | "awaiting" | "watch" | "releasing";

export function attention(signal: DamSignal | null): DamAttention {
  if (!signal) return "none";
  if (signal.grade === "releasing") return "releasing";
  if (signal.grade === "watchful") return "watch";
  if (signal.awaiting.length > 0) return "awaiting";
  return "none";
}

/**
 * Whether this person is shown the notice at all: only someone whose chosen area or watched
 * place is on the river below the dam. Everyone else can still read everything on the map; they
 * are simply not told that water is coming their way, because it is not.
 */
export function onPath(dam: Dam, tambonCodes: readonly string[]): DamTambon | null {
  const mine = new Set(tambonCodes);
  const hits = dam.tambons.filter((t) => mine.has(t.code));
  if (hits.length === 0) return null;
  // The nearest reach to the dam, and the river itself before a tributary.
  return hits.sort(
    (a, b) =>
      (a.via === "main" ? 0 : 1) - (b.via === "main" ? 0 : 1) ||
      (a.kmFromDam ?? Infinity) - (b.kmFromDam ?? Infinity),
  )[0]!;
}

/** The reaches that carry released water, in drawing order: tributaries first, river on top. */
export function reachesInOrder(dam: Dam): DamReach[] {
  const rank: Record<DamReachKind, number> = { tributary: 0, outlet: 1, main: 2 };
  return [...dam.reaches].sort((a, b) => rank[a.kind] - rank[b.kind] || a.seq - b.seq);
}

/** A flow for display: whole m3/s, since the feed's own precision does not justify decimals. */
export function flow(cms: number | null): number | null {
  return cms === null || Number.isNaN(cms) ? null : Math.round(cms);
}

/** Storage as a share of the full reservoir, to one decimal, or null when it cannot be worked out. */
export function fullness(signal: DamSignal | null): number | null {
  return signal?.percentFull ?? null;
}

/**
 * Is the reservoir rising, falling or holding? Only answered where there are enough readings:
 * a missing rate is "unknown", never "steady", because the two mean different things to someone
 * deciding whether to move a car.
 */
export function trend(signal: DamSignal | null): "rising" | "falling" | "steady" | "unknown" {
  const rate = signal?.riseMcmPerH;
  if (rate === null || rate === undefined) return "unknown";
  if (rate > 0.5) return "rising";
  if (rate < -0.5) return "falling";
  return "steady";
}
