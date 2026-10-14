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
 *   * The arrival times (lib/dam-arrival.ts, measured by S7 on the river gauges, 12 Oct 2026) are
 *     ranges in hours after the gates open, and are the only timing the app ever shows. The path
 *     says which way the river runs; it still says nothing about how far the water spreads.
 */

import type { DamArrival } from "@/lib/dam-arrival";
import type { DamDay } from "@/lib/dam-chart";

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

/**
 * The day behind the newest reading: the mean flow over it and the volume that amounts to.
 *
 * The hourly figure and this one answer different questions, and the hourly one alone can say the
 * opposite of what the day did: on 11 Oct the newest hour had the dam releasing nothing, while the
 * day behind it had passed 3.98 million m3 downstream, a mean of 46 m3/s. Inflow is a residual of
 * the storage balance, so single hours even come out negative; a day's sum is the figure the
 * operator's own bulletins use.
 *
 * The hour count travels with each mean, because the feed has gaps and a "daily mean" resting on
 * three hours has to say so (safety rule 8).
 */
export type DamDaily = {
  windowH: number;
  /** The newest reading the window ends at - the feed lags, so the window does not end now. */
  until: string;
  inflowHours: number;
  inflowMeanCms: number | null;
  inflowMcm: number | null;
  outflowHours: number;
  outflowMeanCms: number | null;
  outflowMcm: number | null;
  spilledMcm: number | null;
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
  /** 'hourly' is EGAT's feed; 'daily' is the one figure a day the RID publishes. */
  feed: "hourly" | "daily";
  point: DamPoint | null;
  spillwayPoint: DamPoint | null;
  /** Head of the mapped outlet channel, roughly the powerhouse tailwater. Approximate. */
  outletPoint: DamPoint | null;
  /**
   * The lake. PostGIS gives whichever it has, and Bang Lang's is a **Polygon** with 13 holes,
   * not a MultiPolygon - this said MultiPolygon until 12 Oct, when walking it one level too deep
   * threw in a browser. Anything that reads it must take both.
   */
  reservoir: {
    type: "Polygon" | "MultiPolygon";
    coordinates: number[][][] | number[][][][];
  } | null;
  storageMaxMcm: number | null;
  storageNormalMcm: number | null;
  /** Where the lines came from and what they do not say (safety rule 8). */
  geometrySource: string;
  /** The zone's outlines, joined on by the map once its own request has answered. */
  zones?: DamZone[];
  geometryNote: {
    /** False where OpenStreetMap maps no channel below the reservoir (14 Oct 2026). */
    path_mapped?: boolean;
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
  daily: DamDaily | null;
  /** The last fortnight, a day at a time, oldest first (lib/dam-chart.ts). */
  days: DamDay[];
  /** When released water reaches each tambon on the path (lib/dam-arrival.ts). */
  arrivals: DamArrival[];
};

/** Answer of /api/public/dam. */
export type DamData = { dams: Dam[] };

export const DAM_URL = "/api/public/dam";

/**
 * The land a rise in the river can reach below a dam (S7; the owner chose it with its outer band
 * on 14 Oct 2026). `zone` is land the river has been high enough to reach at the highest levels
 * the gauges have recorded; `outer` is one metre above that. From a 30 m elevation model, not a
 * hydraulic model: it says which land is low enough and joined to the river, never how deep the
 * water will be or that it will come. Asked for by the map only, in its own request, because the
 * outlines are far heavier than everything else about the dam together.
 */
export type DamZone = {
  dam: string;
  band: "zone" | "outer";
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
};
export type DamZoneData = { zones: DamZone[] };
export const DAM_ZONE_URL = "/api/public/dam-zone";

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
 * The dam's state as a colour (the owner's request of 12 Oct: normal green, attention yellow,
 * risky red). They chose Jaga's own alert hues over a second traffic light, so that there is one
 * set of colours in the app to learn - **and that choice is why the words beside the colour do
 * more work here than anywhere else**: this state is worked out by code from the operator's
 * figures, and only a person may issue an alert (safety rule 2). Every place that paints it also
 * says, in words, that these are the dam's own figures and not an alert from Jaga.
 *
 * "unknown" is its own colour and is never green. A dam that has published nothing is not a dam
 * that is behaving: a placeholder must never read as "no risk" (safety rule 10).
 */
export type DamLevel = "unknown" | "normal" | "watch" | "releasing";

export function damLevel(signal: DamSignal | null | undefined): DamLevel {
  if (!signal) return "unknown";
  if (signal.grade === "releasing") return "releasing";
  if (signal.grade === "watchful") return "watch";
  // A rule that has fired once and is waiting for the next reading is worth attention, not calm.
  if (signal.awaiting.length > 0) return "watch";
  return "normal";
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

/**
 * What the map should hold when someone opens the dam's figures: the dam, its two outlets, and
 * **the whole reservoir**, which is the thing that makes the view read as a dam at all. Framing
 * the dam's point alone cut the lake off the bottom of the screen (seen in a browser, 12 Oct).
 *
 * The person's own places are added by the caller, because only the map knows whether they are
 * being shown.
 */
export function damFrame(dam: Dam): { lon: number; lat: number }[] {
  const points: { lon: number; lat: number }[] = [];
  for (const point of [dam.point, dam.spillwayPoint, dam.outletPoint]) {
    if (point) points.push({ lon: point.coordinates[0], lat: point.coordinates[1] });
  }
  if (dam.reservoir) {
    // The lake's corners are enough: a box around them is a box around all of it. The walk is
    // depth-blind on purpose, so a Polygon and a MultiPolygon are both read correctly.
    let west = Infinity;
    let east = -Infinity;
    let south = Infinity;
    let north = -Infinity;
    const walk = (part: unknown): void => {
      if (!Array.isArray(part)) return;
      if (typeof part[0] === "number" && typeof part[1] === "number") {
        const [lon, lat] = part as [number, number];
        if (lon < west) west = lon;
        if (lon > east) east = lon;
        if (lat < south) south = lat;
        if (lat > north) north = lat;
        return;
      }
      for (const deeper of part) walk(deeper);
    };
    walk(dam.reservoir.coordinates);
    if (Number.isFinite(west)) {
      points.push({ lon: west, lat: south }, { lon: east, lat: north });
    }
  }
  return points;
}

/**
 * Who sees the dam's figure on their home screen (the owner's choice of 12 Oct).
 *
 * Anyone whose own area or watched place is on the river below the dam sees it, as they already
 * see the quiet notice - **and so does anyone in Yala, Pattani or Narathiwat**, because a dam
 * upstream of the region is worth knowing about before it is your own tambon's turn.
 *
 * **Songkhla is left out, on the evidence.** Measured from the path itself: the 39 tambons the
 * released water runs through are in Yala (18) and Pattani (21) and nowhere else, and the river
 * ends at 101.244, 6.904 - Pattani Bay. Songkhla lies in its own basins (Songkhla Lake and the
 * U-Taphao), the other side of the divide, so neither a release nor a failure of the dam sends
 * water there; a figure of this dam on a Songkhla home screen would be noise at best and a
 * frightening irrelevance at worst.
 */
/**
 * Whether this dam belongs on **this** person's home screen.
 *
 * The rule is the dam's own path: their area, or a place they watch, is one of the tambons the
 * released water can reach (for Bang Lang that is S7's zone, the river and the low land beside
 * it; for the others the mapped channel below the reservoir).
 *
 * It was wider until 14 Oct 2026 - everyone in Yala, Pattani and Narathiwat saw Bang Lang - and
 * the owner narrowed it the day five more reservoirs arrived: a reservoir that cannot reach you
 * is not news on your home screen, it is noise in front of the SOS button. Every dam is still a
 * tap away on the map.
 */
export function showsDamFigure(dam: Dam, tambonCodes: readonly string[]): boolean {
  if (tambonCodes.length === 0) return false;
  return onPath(dam, tambonCodes) !== null;
}

/**
 * The one dam a home screen carries (the owner, 14 Oct 2026, when five more reservoirs arrived).
 *
 * Every dam that can reach them is a candidate; where two can - a place below Khlong La's stream
 * is also below Khlong Sadao's river - the larger reservoir wins, because it is the one that can
 * do the most. A screen with several dam cards on it is a screen nobody reads.
 */
export function damForFigure(dams: readonly Dam[], tambonCodes: readonly string[]): Dam | null {
  const mine = dams.filter((dam) => showsDamFigure(dam, tambonCodes));
  if (mine.length === 0) return null;
  return mine.reduce((best, dam) =>
    (dam.storageMaxMcm ?? 0) > (best.storageMaxMcm ?? 0) ? dam : best,
  );
}

/** True where OSM has no channel below the reservoir, so the app can say so instead of guessing. */
export function pathMapped(dam: Dam): boolean {
  return dam.geometryNote.path_mapped !== false && dam.reaches.length > 0;
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

/** A volume for display in million m3. Two decimals: a quiet day moves a fraction of one. */
export function volume(mcm: number | null | undefined): number | null {
  return mcm === null || mcm === undefined || Number.isNaN(mcm)
    ? null
    : Math.round(mcm * 100) / 100;
}

/**
 * Fewer than two hours is not an average of anything: one hour would only repeat the reading
 * already on the screen under a word ("mean over the day") that would not be true of it.
 */
export const DAILY_MIN_HOURS = 2;

/**
 * One of the day's two flows, ready to print, or null when there is not enough of a day to call
 * it a mean. The hours are returned so they can be said out loud beside the figure.
 */
export function dailyPart(
  daily: DamDaily | null | undefined,
  which: "inflow" | "outflow",
): { hours: number; cms: number; mcm: number } | null {
  if (!daily) return null;
  const hours = which === "inflow" ? daily.inflowHours : daily.outflowHours;
  const cms = flow(which === "inflow" ? daily.inflowMeanCms : daily.outflowMeanCms);
  const mcm = volume(which === "inflow" ? daily.inflowMcm : daily.outflowMcm);
  if (hours < DAILY_MIN_HOURS || cms === null || mcm === null) return null;
  return { hours, cms, mcm };
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
