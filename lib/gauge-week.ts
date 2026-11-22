/**
 * The week a river has had, prepared for drawing: the eight daily lows `station_status()` counted
 * its "rose on N of the last 7 days" from, as a line.
 *
 * The owner, 22 Nov 2026: "now that we have the records of 7 days water level to tell the user if
 * it's been risen for the past 7 days, instead of just word we should have a minimal graph to
 * support the wording as well, trend graphs".
 *
 * Everything that decides where a point sits is here, and pure, so it is tested rather than
 * trusted. Four rules carry the honesty of the picture:
 *
 *   * **The scale has a floor of half a metre** (`MIN_SPAN_M`). A line fitted to its own range
 *     alone is the easiest way to lie with a chart: a river whose daily low moved two centimetres
 *     all week would be drawn climbing the full height of the box, and a reader would see a flood
 *     in the noise of a still river. With a floor, a week that did not move is drawn not moving,
 *     and only a week whose daily low ranged over more than half a metre fills the box. That
 *     figure is chosen against the real series on jaga-dev (22 Nov 2026): a quiet station wanders
 *     10-15 cm in a week and stays visibly flat under it, while a week that really went somewhere
 *     - X.119 rising 0.90 m - still uses the whole height. The eight figures beside the line, and
 *     the range the box covers printed under it, are the answer to "how much, exactly".
 *   * **No level on this chart.** The series is of daily *lows*, and a daily low below Watch says
 *     nothing about whether that day's peak was. Drawing the Watch, Warning or Evacuate line
 *     across it would be a claim the series cannot support, so the thresholds stay on the
 *     cross-section (lib/gauge-section.ts), which is drawn from the reading they grade. This is a
 *     measurement, not a level and not a forecast (safety rules 2 and 8).
 *   * **One hue, never the alert palette.** The line is the river's own blue wherever it sits, for
 *     the same reason the cross-section's water is: a reading is not an alert (docs/brand.md, and
 *     the dam's charts in lib/dam-chart.ts took this decision first).
 *   * **Eight figures or none.** The database returns the series only when the whole run of days is
 *     behind it, and this refuses to draw a partial one: a line with a day missing in the middle
 *     would read as a day the river did not rise (safety rule 10).
 */

/** The drawing's own coordinate space; it is scaled to whatever width the card gives it. */
export const WEEK_W = 300;
export const WEEK_H = 64;
/** Clear space for the dots' radius, so the first and last never sit half outside the box. */
const PAD_X = 10;
const PAD_Y = 8;

/**
 * The smallest range the scale will show, in metres. See the header: without it a still river is
 * drawn as a dramatic one.
 */
export const MIN_SPAN_M = 0.5;

/** How many daily lows `station_status()` sends, oldest first. */
export const WEEK_DAYS = 8;

export type WeekPoint = {
  /** 0 for the oldest day, 7 for yesterday. */
  index: number;
  x: number;
  y: number;
  metres: number;
  /** Higher than the day before it. The first day has no day before it, so it is false. */
  rose: boolean;
};

export type Week = {
  points: WeekPoint[];
  /** The polyline through every point, for one stroke. */
  path: string;
  /** Metres at the top and bottom of the drawing, after the floor above is applied. */
  top: number;
  bottom: number;
  /** The series' own lowest and highest daily low, unpadded. */
  low: number;
  high: number;
  /** Yesterday less the oldest day, m, rounded as the database rounds it. */
  change: number;
  /** On how many of the seven comparisons the daily low rose. */
  rose: number;
};

/** Whether this gauge has a week that can be drawn at all. */
export function hasWeek(floors: readonly (number | null)[] | null | undefined): boolean {
  return (
    Array.isArray(floors) &&
    floors.length === WEEK_DAYS &&
    floors.every((f) => typeof f === "number" && Number.isFinite(f))
  );
}

/**
 * The eight daily lows as a line. Returns null unless the whole run is there, so a caller cannot
 * accidentally draw a partial week.
 */
export function riverWeek(floors: readonly (number | null)[] | null | undefined): Week | null {
  if (!hasWeek(floors)) return null;
  const metres = (floors as readonly number[]).slice();

  const low = Math.min(...metres);
  const high = Math.max(...metres);
  // The floor on the range, and it is applied around the middle of the week so a still river
  // sits in the centre of the box rather than along its bottom edge.
  const middle = (low + high) / 2;
  const span = Math.max(high - low, MIN_SPAN_M);
  const top = middle + span / 2;
  const bottom = middle - span / 2;

  const step = (WEEK_W - PAD_X * 2) / (WEEK_DAYS - 1);
  const points: WeekPoint[] = metres.map((m, index) => ({
    index,
    x: round(PAD_X + index * step),
    // Metres up the page, pixels down it.
    y: round(PAD_Y + ((top - m) / span) * (WEEK_H - PAD_Y * 2)),
    metres: m,
    rose: index > 0 && m > (metres[index - 1] as number),
  }));

  return {
    points,
    path: points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x} ${p.y}`).join(" "),
    top,
    bottom,
    low,
    high,
    // Rounded the way the database rounds `week_change_m`, so the line and the sentence beside it
    // can never quote two different figures.
    change: round2((metres[WEEK_DAYS - 1] as number) - (metres[0] as number)),
    rose: metres.reduce(
      (count, m, i) => (i > 0 && m > (metres[i - 1] as number) ? count + 1 : count),
      0,
    ),
  };
}

/** One decimal place is plenty for a coordinate and keeps the markup small. */
function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
