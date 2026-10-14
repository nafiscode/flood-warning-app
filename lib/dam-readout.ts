import type { Dam, DamSignal } from "@/lib/dam";

/*
 * The instrument panel at the top of a reservoir's report (the owner, 14 Oct 2026): the figures a
 * reader who knows water wants first, with their units, their datum and where each one came from.
 * Everything here is arithmetic on the figures the operator published - nothing is modelled,
 * nothing is forecast - and the maths lives apart from the drawing so it can be tested.
 */

/**
 * The stored volume, and which published figure it is.
 *
 * It is not always in the newest hour: ThaiWater's hourly series for Bang Lang's storage and
 * level runs behind its flows, and on 14 Oct the newest hour carried flows and no storage at all.
 * The daily series still had it, so the panel falls back to the newest figure of that day and
 * says which day it is rather than leaving its best two cells empty.
 */
export type StorageNow = {
  mcm: number;
  levelM: number | null;
  /** 'hour' is the hour the operator published; 'day' is the newest figure of that day. */
  from: "hour" | "day";
  /** The day the figure belongs to when it comes from the daily series, as YYYY-MM-DD. */
  day: string | null;
  /** The share the database worked out itself, where it has one. */
  percentFull: number | null;
};

export function storageNow(dam: Dam): StorageNow | null {
  const signal = dam.signal;
  if (signal?.storageMcm != null) {
    return {
      mcm: signal.storageMcm,
      levelM: signal.levelM,
      from: "hour",
      day: null,
      percentFull: signal.percentFull,
    };
  }
  for (let i = dam.days.length - 1; i >= 0; i -= 1) {
    const day = dam.days[i]!;
    if (day.storageEndMcm != null) {
      return {
        mcm: day.storageEndMcm,
        levelM: day.levelEndM,
        from: "day",
        day: day.day,
        percentFull: null,
      };
    }
  }
  return null;
}

/** How full the reservoir is, against both denominators. */
export type Fullness = {
  /** Share of the maximum capacity, 0 to 1 (and over 1 is possible: Jan 2021 passed it). */
  ofMax: number;
  percentMax: number;
  /**
   * Thai bulletins and the news quote the capacity at normal high water level, which is lower
   * than the maximum, so the same reservoir reads fuller there than it does here. Both are shown
   * and both are named (the open question of 10 Oct). It is null where the operator publishes
   * only one capacity - the five RID reservoirs publish the same figure for both.
   */
  percentNormal: number | null;
  /** Where normal high water sits on the dial's own scale, 0 to 1; null when it is not a mark. */
  normalMark: number | null;
  /** What the reservoir would still take before normal high water, in million m³. */
  roomToNormalMcm: number | null;
};

/** Under this much apart, the two capacities are the same figure and only one is worth saying. */
const CAPACITIES_DIFFER = 0.01;

export function fullnessOf(dam: Dam, storage: StorageNow | null): Fullness | null {
  const max = dam.storageMaxMcm;
  if (!storage || !max || max <= 0) return null;
  const published = dam.storageNormalMcm;
  const normal =
    published && published > 0 && Math.abs(max - published) / max > CAPACITIES_DIFFER
      ? published
      : null;
  return {
    ofMax: storage.mcm / max,
    percentMax: Math.round(storage.percentFull ?? (storage.mcm / max) * 100),
    percentNormal: normal ? Math.round((storage.mcm / normal) * 100) : null,
    normalMark: normal ? normal / max : null,
    roomToNormalMcm: normal ? Math.round((normal - storage.mcm) * 10) / 10 : null,
  };
}

/** The dial is an instrument's three quarters of a circle, open at the bottom. */
export const DIAL_SWEEP = 270;
/** Where the arc starts, in degrees clockwise from three o'clock (SVG's own zero). */
export const DIAL_START = 135;

/** The dash pattern that draws `fraction` of the dial on a circle of this radius. */
export function dialDash(fraction: number, radius: number) {
  const circumference = 2 * Math.PI * radius;
  const arc = (circumference * DIAL_SWEEP) / 360;
  const shown = Math.max(0, Math.min(1, fraction)) * arc;
  return {
    track: `${arc} ${circumference}`,
    value: `${shown} ${circumference}`,
    circumference,
  };
}

/** Where a mark at `fraction` sits on the dial, in degrees clockwise from three o'clock. */
export function dialAngle(fraction: number): number {
  return DIAL_START + Math.max(0, Math.min(1, fraction)) * DIAL_SWEEP;
}

export type FlowNow = {
  cms: number;
  /** 'hour' is the hour the operator published; 'mean' is the mean over `hours` hours. */
  from: "hour" | "mean";
  hours: number;
  /**
   * The mean over the day behind it, when the figure above is one hour. The two answer different
   * questions and the hour alone can say the opposite of what the day did: on 11 Oct the newest
   * hour had Bang Lang releasing nothing while the day behind it had passed 3.98 million m³.
   */
  meanCms: number | null;
  meanHours: number;
};

/**
 * What is coming in and going out. An hourly dam answers with its newest hour and carries the
 * day's mean beside it; a reservoir the RID publishes once a day has no hour, so the day's mean
 * is the figure and it says so.
 */
export function flowNow(dam: Dam, which: "inflow" | "outflow"): FlowNow | null {
  const signal = dam.signal;
  const hour = which === "inflow" ? (signal?.inflowCms ?? null) : (signal?.outflowCms ?? null);
  const daily = dam.daily;
  const mean =
    which === "inflow" ? (daily?.inflowMeanCms ?? null) : (daily?.outflowMeanCms ?? null);
  const hours = which === "inflow" ? (daily?.inflowHours ?? 0) : (daily?.outflowHours ?? 0);
  const day = mean !== null && hours > 0 ? { mean, hours } : null;
  if (dam.feed === "hourly" && hour !== null) {
    return {
      cms: hour,
      from: "hour",
      hours: 1,
      meanCms: day?.mean ?? null,
      meanHours: day?.hours ?? 0,
    };
  }
  if (day) return { cms: day.mean, from: "mean", hours: day.hours, meanCms: null, meanHours: 0 };
  if (hour === null) return null;
  return { cms: hour, from: "hour", hours: 1, meanCms: null, meanHours: 0 };
}

export type StorageChange = {
  mcmPerH: number;
  windowH: number;
  way: "rising" | "falling" | "steady";
};

/** How fast the stored volume is moving, measured from the readings themselves. */
export function changeOf(signal: DamSignal | null): StorageChange | null {
  if (!signal || signal.riseMcmPerH === null) return null;
  const rate = signal.riseMcmPerH;
  return {
    mcmPerH: rate,
    windowH: signal.riseWindowH,
    // Under a hundredth of a million cubic metres an hour prints as 0.00, so it is held steady.
    way: rate >= 0.005 ? "rising" : rate <= -0.005 ? "falling" : "steady",
  };
}
