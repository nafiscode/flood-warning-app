/**
 * The cross-section of a river at one gauge: the channel, the water in it now, and the station's
 * own Watch, Warning and Evacuate levels as lines across it.
 *
 * The owner, 19 Nov 2026: a gauge opened from the map should show "the river bed with the river
 * live level with the line of the watch, alert and evacuate, similar to the one in Nara flood".
 *
 * Two things are measured here and two are drawn, and the component keeps them apart in words:
 *
 *   * **Measured.** The water level, and the three levels (`station_status()` returns the very ones
 *     the gauge's status word was decided on, so the picture and the word cannot disagree). Every
 *     one of them is printed as a number in metres above mean sea level as well as drawn.
 *   * **Drawn only.** The shape of the channel and the depth of the bed. Jaga has no surveyed
 *     cross-section for these stations, so the bed is a drawing: it is put far enough below the
 *     lowest figure to hold the water, and never labelled with a height. The card says so.
 *
 * The three lines wear the alert palette, as the explainer's gauge figure already does
 * (components/how/Figures.tsx), and each one is named in words beside the drawing: a level is
 * never colour alone (CLAUDE.md accessibility). The water itself keeps the map's water colour
 * whatever it reads, because a reading is a measurement and not an alert (safety rule 2).
 */

export const SECTION_LEVELS = ["watch", "warning", "evacuate"] as const;
export type SectionLevelKey = (typeof SECTION_LEVELS)[number];

/** The drawing's own coordinate space; it is scaled to whatever width the card gives it. */
export const SECTION_W = 340;
export const SECTION_H = 190;
/** Clear space kept above the highest figure and below the bed, in the same units. */
const PAD_TOP = 10;
const PAD_BOTTOM = 8;

/** Where the channel's walls stand at bank height, and where its bed runs. */
const BANK_L = 46;
const BANK_R = 294;
const BED_L = 112;
const BED_R = 228;

export type SectionInput = {
  /** The newest reading, m MSL, or null when the station has gone quiet. */
  value: number | null;
  watch?: number | null;
  warning?: number | null;
  evacuate?: number | null;
  /** The bank level, m MSL (on most gauges the same as Evacuate). */
  bank?: number | null;
};

export type SectionLine = { key: SectionLevelKey; metres: number; y: number };

export type Section = {
  /** Metres at the top of the drawing, and at the drawn bed. */
  top: number;
  bedMetres: number;
  /** Metres to a y in the drawing's units. */
  yOf: (metres: number) => number;
  /** The water's surface, and null when there is no reading to draw. */
  surfaceY: number | null;
  /** The bank's y, and the metres it stands at when they are known. */
  bankY: number;
  bankMetres: number | null;
  /** The three levels that are known, lowest first. */
  lines: SectionLine[];
  /** True when the reading is at or over the bank, so the water spreads past the channel. */
  overBank: boolean;
  /** The ground: both banks with the channel cut out of it. */
  groundPath: string;
  /** Where water may be drawn: inside the channel, and over everything above the bank. */
  channelPath: string;
  /** How far the water rises from the bed when the drawing opens, in the drawing's units. */
  riseFrom: number;
};

/**
 * Whether there is anything to draw: a reading, a level or a bank. With none of the three the
 * details card leaves the drawing out altogether rather than showing an empty channel.
 */
export function hasSection(input: SectionInput): boolean {
  return [input.value, input.watch, input.warning, input.evacuate, input.bank].some(
    (m) => typeof m === "number" && Number.isFinite(m),
  );
}

/**
 * The drawing's vertical scale. It has to hold every figure there is - the reading, the three
 * levels and the bank - because a line that fell off the top would read as "not reached".
 */
export function riverSection(input: SectionInput): Section {
  const { value, bank } = input;
  const levels = SECTION_LEVELS.map((key) => ({ key, metres: input[key] })).filter(
    (l): l is { key: SectionLevelKey; metres: number } =>
      typeof l.metres === "number" && Number.isFinite(l.metres),
  );
  const figures = [
    ...levels.map((l) => l.metres),
    ...(typeof bank === "number" && Number.isFinite(bank) ? [bank] : []),
    ...(typeof value === "number" && Number.isFinite(value) ? [value] : []),
  ];
  // With nothing to go on at all, a plain 0..1 m frame: the drawing then shows a channel and says
  // in words that there is no reading and no level, rather than inventing either.
  const high = figures.length ? Math.max(...figures) : 1;
  const low = figures.length ? Math.min(...figures) : 0;
  const span = Math.max(high - low, 0.5);
  const top = high + span * 0.28;
  const bedMetres = low - span * 0.62;
  const plot = SECTION_H - PAD_TOP - PAD_BOTTOM;
  const yOf = (metres: number) =>
    PAD_TOP + ((top - metres) / (top - bedMetres)) * plot;

  const bankMetres =
    typeof bank === "number" && Number.isFinite(bank)
      ? bank
      : // No bank of its own: Evacuate is the bank on every gauge that has one.
        (levels.find((l) => l.key === "evacuate")?.metres ?? null);
  // With neither, the walls reach the top of the drawing, so nothing is drawn as overtopping
  // ground whose height nobody knows.
  const bankY = yOf(bankMetres ?? top);
  const surfaceY =
    typeof value === "number" && Number.isFinite(value)
      ? Math.min(Math.max(yOf(value), PAD_TOP * 0.4), yOf(bedMetres))
      : null;
  const bedY = yOf(bedMetres);

  // The bed, as a drawing: a shallow curve between the two walls.
  const bed = `C ${BANK_L + 26} ${bankY} ${BED_L - 16} ${bedY} ${BED_L} ${bedY} L ${BED_R} ${bedY} C ${BANK_R - 26} ${bedY} ${BANK_R - 20} ${bankY} ${BANK_R} ${bankY}`;
  const groundPath = `M0 ${bankY} L ${BANK_L} ${bankY} ${bed} L ${SECTION_W} ${bankY} L ${SECTION_W} ${SECTION_H} L 0 ${SECTION_H} Z`;
  // Two shapes in one path: the channel itself, and the whole width above the bank. Water is
  // clipped to this, so it fills the channel and, only once it is over the bank, the ground too.
  const channelPath = `M${BANK_L} ${bankY} ${bed} Z M0 0 L ${SECTION_W} 0 L ${SECTION_W} ${bankY} L 0 ${bankY} Z`;

  return {
    top,
    bedMetres,
    yOf,
    surfaceY,
    bankY,
    bankMetres,
    lines: levels
      .map(({ key, metres }) => ({ key, metres, y: yOf(metres) }))
      .sort((a, b) => a.metres - b.metres),
    overBank:
      bankMetres !== null && typeof value === "number" && Number.isFinite(value) && value >= bankMetres,
    groundPath,
    channelPath,
    riseFrom: surfaceY === null ? 0 : Math.max(bedY - surfaceY, 0),
  };
}

/**
 * One band of water surface: a sine run three drawings wide, closed downwards so it fills. The
 * band is drifted sideways by exactly one wavelength on a loop, which is why the run has to be
 * wider than the drawing - the water never shows an end.
 */
export function waveLine(length: number, amplitude: number): string {
  const from = -SECTION_W;
  const to = SECTION_W * 2;
  const step = length / 12;
  let d = `M${from} 0`;
  for (let x = from + step; x <= to; x += step) {
    const y = Math.sin(((x - from) / length) * Math.PI * 2) * amplitude;
    d += ` L${x.toFixed(2)} ${y.toFixed(2)}`;
  }
  return d;
}

/** The same run closed downwards, so it fills as a body of water rather than drawing a line. */
export function wavePath(length: number, amplitude: number, depth = SECTION_H): string {
  const to = SECTION_W * 2;
  return `${waveLine(length, amplitude)} L${to} ${depth} L${-SECTION_W} ${depth} Z`;
}

/**
 * The two bands of the surface. The second is shorter, quicker and drifts the other way, which is
 * what stops the water reading as one sliding shape. Both lengths divide the drawing's width, so
 * each loop ends exactly where it began and no seam ever shows.
 */
export type WaveBand = {
  length: number;
  amplitude: number;
  seconds: number;
  opacity: number;
  /** Drifts the other way, and sits behind the first. */
  back: boolean;
};
export const WAVE_BANDS: readonly WaveBand[] = [
  { length: 170, amplitude: 3.4, seconds: 7, opacity: 1, back: false },
  { length: 113.333, amplitude: 2.2, seconds: 4.6, opacity: 0.5, back: true },
];
