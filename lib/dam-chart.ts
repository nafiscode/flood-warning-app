/**
 * The dam's fortnight, prepared for drawing (the owner's request of 12 Oct: charts of the water
 * leaving the dam, so that a release which has been growing for days can be *seen* growing).
 *
 * Everything that decides what a bar is tall is here, and pure, so it is tested rather than
 * trusted. The rules that matter:
 *
 *   * **One hue, length carries the magnitude.** Jaga has a single teal and its steps sit about
 *     10 apart for normal colour vision, under the floor of 15 that telling two series apart by
 *     colour needs, and the alert palette is reserved for levels a person issued (docs/brand.md).
 *     So the release and the spill are never two colours on one chart: they are two charts on
 *     **one shared scale**, each with its own words, which is also what a reader with any colour
 *     vision gets.
 *   * **A day with fewer published hours is not a quiet day.** The feed has gaps, so each day
 *     carries the number of hourly readings behind it, a short day is drawn fainter, and the run
 *     of rising days is counted over whole days only.
 *   * **No forecast.** The run says what the record did, never what it will do (safety rule 8).
 */

export type DamDay = {
  /** A Bangkok calendar date, "YYYY-MM-DD". Never put through a browser's own time zone. */
  day: string;
  /** Hourly readings behind this day. 0 means the feed published nothing for it. */
  hours: number;
  releasedMeanCms: number | null;
  spilledMeanCms: number | null;
  outflowMeanCms: number | null;
  outflowMcm: number | null;
  spilledMcm: number | null;
  storageEndMcm: number | null;
  levelEndM: number | null;
};

/** A day needs this many of its 24 hours before it counts as a whole day. */
export const WHOLE_DAY_HOURS = 20;

/** Which measure a chart draws. Both are means over the day, in cubic metres a second. */
export type DamMeasure = "outflow" | "spill";

export type DamBar = {
  day: string;
  /** Null when the feed published nothing for that day: a gap, not a nought. */
  value: number | null;
  hours: number;
  whole: boolean;
  /** Height as a percentage of the chart's scale, 0-100. */
  percent: number;
};

function measureOf(day: DamDay, measure: DamMeasure): number | null {
  const value = measure === "outflow" ? day.outflowMeanCms : day.spilledMeanCms;
  return day.hours > 0 && value !== null && value !== undefined && !Number.isNaN(value)
    ? value
    : null;
}

/**
 * The top of the scale: a clean 1, 2 or 5 above the tallest day of **either** measure, so the
 * two charts can be read against each other. Never below 1, so a dam doing nothing still gets an
 * axis rather than a division by zero.
 */
export function scaleFor(days: readonly DamDay[]): number {
  const top = Math.max(
    0,
    ...days.map((d) => measureOf(d, "outflow") ?? 0),
    ...days.map((d) => measureOf(d, "spill") ?? 0),
  );
  if (top <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(top));
  for (const step of [1, 2, 5, 10]) {
    if (top <= step * power) return step * power;
  }
  return 10 * power;
}

/** The bars of one chart, oldest first, all on the scale the two charts share. */
export function bars(days: readonly DamDay[], measure: DamMeasure, scale: number): DamBar[] {
  return days.map((d) => {
    const value = measureOf(d, measure);
    return {
      day: d.day,
      value,
      hours: d.hours,
      whole: d.hours >= WHOLE_DAY_HOURS,
      /*
       * A published day is always a mark, even a day of nothing: "the dam released none" and
       * "the feed published none" must not look the same, and only the first of those is a fact.
       * A day with no readings has no bar at all, and the table says so in words.
       */
      percent: value === null ? 0 : Math.max(2, Math.min(100, (value / scale) * 100)),
    };
  });
}

/** Was there any water over the spillway in the window? A chart of noughts says less than a line. */
export function hadSpill(days: readonly DamDay[]): boolean {
  return days.some((d) => (d.spilledMcm ?? 0) > 0 || (d.spilledMeanCms ?? 0) > 0);
}

export type DamRun = {
  direction: "rising" | "falling" | "steady";
  /** How many whole days the direction has held, counting the days that changed. */
  days: number;
  from: number;
  to: number;
};

/**
 * The run of days at the end of the record: what the owner asked the chart to make visible, said
 * in words as well, for someone who reads the sentence and not the picture.
 *
 * Only whole days count. A part-published day at the end would otherwise read as a fall every
 * morning, because the feed has only published a few of its hours.
 */
export function run(days: readonly DamDay[], measure: DamMeasure = "outflow"): DamRun | null {
  const values = days
    .filter((d) => d.hours >= WHOLE_DAY_HOURS)
    .map((d) => measureOf(d, measure))
    .filter((v): v is number => v !== null);
  if (values.length < 2) return null;
  const last = values.length - 1;
  // A day has to move by more than a twentieth to count as a move at all: the published figures
  // wobble by a per cent or so from hour to hour, and that is not a trend.
  const moved = (a: number, b: number) => Math.abs(b - a) > Math.max(a * 0.05, 0.5);
  const up = values[last]! > values[last - 1]!;
  if (!moved(values[last - 1]!, values[last]!)) {
    return { direction: "steady", days: 1, from: values[last - 1]!, to: values[last]! };
  }
  let i = last;
  while (i > 0 && moved(values[i - 1]!, values[i]!) && values[i]! > values[i - 1]! === up) i -= 1;
  return {
    direction: up ? "rising" : "falling",
    days: last - i,
    from: values[i]!,
    to: values[last]!,
  };
}

/**
 * The reservoir itself, day by day: the cause behind the releases.
 *
 * **The axis runs from empty to the reservoir's full capacity, never from the lowest day drawn.**
 * The storage moves by a fraction of a per cent on an ordinary day - 743.9 to 748.3 million m3
 * over the fortnight measured on 12 Oct - and an axis zoomed onto that range would turn rounding
 * into a mountain range. Against the dam's own capacity the same fortnight reads as what it is:
 * half full and flat, with the line climbing towards the normal high water mark when it matters.
 * The day-to-day figures are in the table for anyone who wants them.
 */
export type DamPoint = { day: string; value: number; percent: number; x: number; y: number };

/**
 * The line, in percentages of the box, as runs of days with no gap in them. A day the feed never
 * published breaks the line rather than being drawn through: a line across a gap is invented data.
 */
export function storageLine(days: readonly DamDay[], capacityMcm: number): DamPoint[][] {
  const top = capacityMcm > 0 ? capacityMcm : 1;
  const span = Math.max(days.length - 1, 1);
  const runs: DamPoint[][] = [];
  let current: DamPoint[] = [];
  days.forEach((day, i) => {
    const value = day.hours > 0 ? day.storageEndMcm : null;
    if (value === null || value === undefined || Number.isNaN(value)) {
      if (current.length > 0) runs.push(current);
      current = [];
      return;
    }
    const share = Math.max(0, Math.min(1, value / top));
    current.push({
      day: day.day,
      value,
      percent: Math.round(share * 1000) / 10,
      x: (i / span) * 100,
      // SVG counts down from the top; the water counts up from the bottom.
      y: 100 - share * 100,
    });
  });
  if (current.length > 0) runs.push(current);
  return runs;
}

/** Where a mark sits on that axis, for the capacity at normal high water and the like. */
export function levelY(mcm: number | null | undefined, capacityMcm: number): number | null {
  if (mcm === null || mcm === undefined || !(capacityMcm > 0)) return null;
  const share = mcm / capacityMcm;
  // Only drawn when it is really on the chart; above the capacity it would sit on the frame.
  return share > 0 && share < 1 ? 100 - share * 100 : null;
}

/** The last day the feed published anything for, which is what the figures are "as at". */
export function lastDay(days: readonly DamDay[]): DamDay | null {
  for (let i = days.length - 1; i >= 0; i -= 1) {
    if (days[i]!.hours > 0) return days[i]!;
  }
  return null;
}
