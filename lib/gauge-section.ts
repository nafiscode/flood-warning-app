/**
 * The cross-section of a river at one gauge: the channel, the water in it now, and the station's
 * own Watch, Warning and Evacuate levels as lines across it.
 *
 * The owner, 19 Nov 2026: a gauge opened from the map should show "the river bed with the river
 * live level with the line of the watch, alert and evacuate, similar to the one in Nara flood".
 *
 * What is measured and what is drawn are kept apart, here and in the words the card prints:
 *
 *   * **Measured.** The water level and the three levels (`station_status()` returns the very ones
 *     the gauge's status word was decided on, so the picture and the word cannot disagree); and,
 *     where the station has them, the channel itself - the bed and the two bank heights from
 *     ThaiWater's own record, and the width measured across OpenStreetMap's digitised water
 *     (pipeline/gauge_section). Every one of them is printed in metres as well as drawn.
 *   * **Drawn only.** The shape of the sides between the bed and the banks. There is no surveyed
 *     cross-section for these stations and none is invented: a station with no channel figures
 *     keeps the schematic channel, with its bed put far enough below the lowest level to hold the
 *     water and carrying no height at all. The card says which of the two it is looking at.
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

/**
 * How far a listed bank height may sit from the station's own levels before it is treated as
 * being on another datum and dropped. See the note in `riverSection`: the sane stations sit
 * within 4.28 m, the one bad one 33.64 m away.
 */
export const DATUM_TOLERANCE_M = 10;

export type SectionInput = {
  /** The newest reading, m MSL, or null when the station has gone quiet. */
  value: number | null;
  watch?: number | null;
  warning?: number | null;
  evacuate?: number | null;
  /** The bank level, m MSL (on most gauges the same as Evacuate). */
  bank?: number | null;
  /**
   * The channel itself, where it is known (`public.gauge_channel`, 19 Nov 2026): the bed and the
   * two bank heights as ThaiWater lists them, and the width of the water as OpenStreetMap has it
   * mapped. Any of them may be missing, and missing is drawn as missing.
   */
  bed?: number | null;
  leftBank?: number | null;
  rightBank?: number | null;
  /** Named as the gauge names it: `riverSection` is called with a `Gauge` and must not miss it. */
  channelWidth?: number | null;
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
  /**
   * The two banks as they are drawn. They are the station's own heights where it has them, which
   * differ at half the gauges - and the lower one is the bank the river leaves first.
   */
  leftY: number;
  rightY: number;
  leftMetres: number | null;
  rightMetres: number | null;
  /** The bed, when the station's own bed level is known; `cut` when it is deeper than the frame. */
  bed: { metres: number; y: number; cut: boolean } | null;
  /** The channel's depth from the lower bank to the bed, in metres. */
  depth: number | null;
  /** The river's width in metres, where it could be measured. */
  width: number | null;
  /** Where the channel's walls and bed stand in the drawing. */
  channel: { bankL: number; bankR: number; bedL: number; bedR: number };
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
  return [
    input.value,
    input.watch,
    input.warning,
    input.evacuate,
    input.bank,
    input.bed,
    input.channelWidth,
  ].some((m) => typeof m === "number" && Number.isFinite(m));
}

/**
 * The drawing's vertical scale. It has to hold every figure there is - the reading, the three
 * levels and the bank - because a line that fell off the top would read as "not reached".
 */
export function riverSection(input: SectionInput): Section {
  const { value, bank } = input;
  const own = (m: unknown) => (typeof m === "number" && Number.isFinite(m) ? m : null);
  const levels = SECTION_LEVELS.map((key) => ({ key, metres: input[key] })).filter(
    (l): l is { key: SectionLevelKey; metres: number } =>
      typeof l.metres === "number" && Number.isFinite(l.metres),
  );
  /*
   * The frame is set by the station's own levels, NOT by what it is reading now (the owner, 19 Nov
   * 2026: stepping from one gauge to the next, "the animated cross sections looks the same, just
   * numbering under it changes"). That was the first scale's doing: it took the reading into the
   * span, so every station's water came out at much the same height and only the figures moved.
   *
   * With the levels holding the frame, the three lines land in about the same place at every
   * station and the water is free to sit where the river really stands against them - low at a
   * river well under its Watch, near the top at one close to its bank. That is the picture a
   * reader can compare between stations, which is what makes stepping through them worth doing.
   *
   * A reading outside the levels still stretches the frame to hold it, because a figure that fell
   * off the drawing would read as "not reached" (or as a dry channel) - but only by what it takes
   * to show it, so the lines keep their places in every ordinary case.
   */
  /*
   * The channel's heights are only drawn if they are on the SAME DATUM as the levels (22 Nov
   * 2026). ThaiWater's station record gives most stations their bank and bed in m MSL, the datum
   * the levels and the reading use - but not all of them: at X.67A บ้านนาสีทอง the banks are
   * listed as 6.28 and 6.29 and the bed as -1.22, which is a real 7.5 m channel measured down
   * from the station's own staff gauge, while its Watch, Warning and Evacuate are 38.65, 39.30
   * and 39.92 m MSL.
   *
   * Drawn together, those two datums put the water 29 m above both banks, and the card showed a
   * river standing over its banks on both sides while the words beside it said the station was
   * normal. A picture that contradicts the sentence under it is worse than no picture (safety
   * rule 10), and of the two it is the words that are checked.
   *
   * So the test is against the station's own bank level, because the listed bank and that level
   * describe the same physical bank and must agree. Measured on jaga-dev, 22 Nov 2026: of the 46
   * stations with listed heights, 45 sit between 0.00 m and 4.28 m of their bank level (average
   * 0.46 m) and X.67A sits 33.64 m below it. Ten metres is an order of magnitude clear of both.
   *
   * Rejection costs nothing a reader needs: the station keeps the schematic channel and the card
   * says the shape is a drawing, which is what every station without heights already does. The
   * width is not touched - it is a horizontal distance measured across OpenStreetMap's water and
   * has no datum to disagree with.
   */
  const dbBank = own(bank);
  const datum = [...levels.map((l) => l.metres), ...(dbBank !== null ? [dbBank] : [])];
  const sameDatum = (m: number | null) =>
    m === null || datum.length === 0 || datum.some((d) => Math.abs(m - d) <= DATUM_TOLERANCE_M)
      ? m
      : null;
  const listedLeft = own(input.leftBank);
  const listedRight = own(input.rightBank);
  // One bank off the datum condemns the whole channel: the bed is listed on the same datum as the
  // banks, so a bed kept beside rejected banks would be the same mistake with one fewer clue.
  const heightsAgree =
    sameDatum(listedLeft) !== null || sameDatum(listedRight) !== null || datum.length === 0;
  const left = heightsAgree ? listedLeft : null;
  const right = heightsAgree ? listedRight : null;
  const banks = [left, right].filter((m): m is number => m !== null);
  const marks = [...levels.map((l) => l.metres), ...(dbBank !== null ? [dbBank] : []), ...banks];
  const reading = own(value);
  // With nothing to go on at all, a plain 0..1 m frame: the drawing then shows a channel and says
  // in words that there is no reading and no level, rather than inventing either.
  const high = marks.length ? Math.max(...marks) : (reading ?? 1);
  const low = marks.length ? Math.min(...marks) : (reading ?? 0);
  const span = Math.max(high - low, 0.5);
  let top = high + span * (marks.length ? 0.18 : 0.28);
  // Deep enough under the lowest level that a river sitting at its ordinary level still looks like
  // a river. Drawn shallower, a station that is simply normal would read as a dry bed.
  let bedMetres = low - span * (marks.length ? 0.9 : 0.62);
  if (reading !== null) {
    top = Math.max(top, reading + span * 0.08);
    bedMetres = Math.min(bedMetres, reading - span * 0.55);
  }
  /*
   * The station's own bed, where ThaiWater lists one. A channel can be far deeper than the band
   * its levels sit in - nineteen metres at one gauge here against a level span of one - and drawn
   * to scale that would squeeze the three lines into the top tenth of the picture, which is the
   * part a reader has to read. So a bed deeper than the frame can hold is CUT: the drawing shows
   * the channel going down past a break, and the words give the bed's real height. Nothing is
   * ever drawn as shallower than it is without saying so.
   */
  // The bed is listed on the same datum as the banks, so it stands or falls with them.
  const bedOwn = heightsAgree ? own(input.bed) : null;
  const floor = low - span * 2.4;
  let bedCut = false;
  if (bedOwn !== null) {
    if (bedOwn < floor) {
      bedCut = true;
      bedMetres = Math.min(bedMetres, floor);
    } else {
      bedMetres = Math.min(bedMetres, bedOwn);
    }
  }
  const plot = SECTION_H - PAD_TOP - PAD_BOTTOM;
  const yOf = (metres: number) => PAD_TOP + ((top - metres) / (top - bedMetres)) * plot;

  const bankMetres =
    dbBank !== null
      ? dbBank
      : banks.length
        ? Math.min(...banks)
        : // No bank of its own: Evacuate is the bank on every gauge that has one.
          (levels.find((l) => l.key === "evacuate")?.metres ?? null);
  // With neither, the walls reach the top of the drawing, so nothing is drawn as overtopping
  // ground whose height nobody knows.
  const bankY = yOf(bankMetres ?? top);
  const leftY = yOf(left ?? bankMetres ?? top);
  const rightY = yOf(right ?? bankMetres ?? top);
  const surfaceY =
    reading !== null ? Math.min(Math.max(yOf(reading), PAD_TOP * 0.4), yOf(bedMetres)) : null;
  const bedY = yOf(bedMetres);

  /*
   * How wide the channel is drawn. With a measured width it is that river's own: a canal a few
   * metres across is a narrow notch, a river two hundred metres across spans the drawing. The
   * scale is logarithmic between 8 m and 250 m, because the difference between 10 m and 40 m
   * matters to a reader and the difference between 400 m and 600 m does not. Without a width the
   * channel keeps a middling default shape, and the card says the width is not known.
   */
  const width = own(input.channelWidth);
  const wide =
    width === null
      ? null
      : Math.min(Math.max((Math.log(width) - Math.log(8)) / (Math.log(250) - Math.log(8)), 0), 1);
  const half = wide === null ? 124 : 70 + wide * 80;
  const bedHalf = wide === null ? 58 : half * (0.22 + wide * 0.5);
  const mid = SECTION_W / 2;
  const bankL = mid - half;
  const bankR = mid + half;
  const bedL = mid - bedHalf;
  const bedR = mid + bedHalf;

  // The bed, drawn between the two walls. The slope of the sides is the part nobody has surveyed.
  const slope = Math.max((bedL - bankL) * 0.45, 6);
  const bed = `C ${bankL + slope} ${leftY} ${bedL - slope * 0.6} ${bedY} ${bedL} ${bedY} L ${bedR} ${bedY} C ${bedR + slope * 0.6} ${bedY} ${bankR - slope} ${rightY} ${bankR} ${rightY}`;
  const groundPath = `M0 ${leftY} L ${bankL} ${leftY} ${bed} L ${SECTION_W} ${rightY} L ${SECTION_W} ${SECTION_H} L 0 ${SECTION_H} Z`;
  /*
   * Where water may be drawn: the channel, and above each bank on that bank's own side. With one
   * bank lower than the other - which is half of these stations - water over the lower bank
   * spreads across that side while the higher bank still holds it, which is what really happens.
   */
  const channelPath = [
    `M${bankL} ${leftY} ${bed} Z`,
    `M0 0 L ${bankL} 0 L ${bankL} ${leftY} L 0 ${leftY} Z`,
    `M${bankR} 0 L ${SECTION_W} 0 L ${SECTION_W} ${rightY} L ${bankR} ${rightY} Z`,
  ].join(" ");

  const depth =
    bedOwn !== null && bankMetres !== null && bankMetres > bedOwn
      ? Math.round((bankMetres - bedOwn) * 100) / 100
      : null;

  return {
    top,
    bedMetres,
    yOf,
    surfaceY,
    bankY,
    bankMetres,
    leftY,
    rightY,
    leftMetres: left,
    rightMetres: right,
    bed: bedOwn === null ? null : { metres: bedOwn, y: bedY, cut: bedCut },
    depth,
    width,
    channel: { bankL, bankR, bedL, bedR },
    lines: levels
      .map(({ key, metres }) => ({ key, metres, y: yOf(metres) }))
      .sort((a, b) => a.metres - b.metres),
    overBank: bankMetres !== null && reading !== null && reading >= bankMetres,
    groundPath,
    channelPath,
    riseFrom: surfaceY === null ? 0 : Math.max(bedY - surfaceY, 0),
  };
}

/** The break drawn across a bed deeper than the picture: the drawing is cut, never shortened. */
export function bedBreak(y: number, from: number, to: number): string {
  const step = (to - from) / 10;
  let d = `M${from} ${y}`;
  for (let i = 1; i <= 10; i++) {
    d += ` L${(from + step * i).toFixed(1)} ${(y + (i % 2 ? 4 : 0)).toFixed(1)}`;
  }
  return d;
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
