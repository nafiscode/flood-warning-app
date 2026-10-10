/**
 * How the dam, its reservoir and the release path are drawn (the owner's request of 10 Oct:
 * always on the map, clearly).
 *
 * Why these particular marks, and not a colour per state:
 *
 *   * **The water colour never changes.** Brand slate and teal never show a status and only the
 *     alert palette does (docs/brand.md). A river that turned amber when the dam opened its
 *     gates would be a sixth alert colour, and one nobody has been taught. The state is said in
 *     words with an icon, in the notice and in the dam's card.
 *   * **Form and words carry identity, not hue.** The map already spends its colours: the alert
 *     palette on the tambons, the ink on report hexagons, safe places and gauges, and ten cool
 *     shades on the places a person watches (lib/mine-colors.ts). So the dam is told apart by a
 *     river line wider than anything else of ours, a reservoir drawn faintly enough to read the
 *     tambon colours through, and labels that are always on - which also works for someone who
 *     does not separate these hues at all.
 *   * **Light and dark both** (the owner, 10 Oct). Every value below has a night twin, checked
 *     against the dark basemap rather than guessed: the daytime water colour disappears into it.
 */

/** Water, by day and by night. Not an alert hue, and the same whatever the dam is doing. */
export const DAM_WATER = "#1b6e8c";
export const DAM_WATER_DARK = "#7ec8e3";
/** The dam wall and its outlets: darker than the water so the marks sit on top of it. */
export const DAM_MARK = "#0d4a5e";
export const DAM_MARK_DARK = "#a8dcef";

export type DamPaint = {
  water: string;
  mark: string;
  /** Behind the river line, so it reads against a coloured tambon underneath. */
  casing: string;
  label: string;
  halo: string;
};

export function damPaint(dark: boolean): DamPaint {
  return dark
    ? {
        water: DAM_WATER_DARK,
        mark: DAM_MARK_DARK,
        casing: "#0b2b38",
        label: "#d7eef7",
        halo: "#0b1b24",
      }
    : {
        water: DAM_WATER,
        mark: DAM_MARK,
        casing: "#ffffff",
        label: "#0d4a5e",
        halo: "#ffffff",
      };
}

/**
 * Line widths by zoom. The river is deliberately wider than anything else of ours: at province
 * zoom a 1.5 px line is lost among the tambon borders, and this one has to be findable at a
 * glance on a 360 px phone.
 */
export const MAIN_WIDTH: [number, number][] = [
  [7, 2.2],
  [9, 3.4],
  [12, 6],
];
export const TRIBUTARY_WIDTH: [number, number][] = [
  [7, 1.2],
  [9, 1.8],
  [12, 3],
];
/** The casing under the river, always a little wider than the line it carries. */
export const CASING_EXTRA = 2.4;

/** A MapLibre "interpolate by zoom" expression from a list of stops. */
export function byZoom(stops: [number, number][]): unknown[] {
  return ["interpolate", ["linear"], ["zoom"], ...stops.flat()];
}

/**
 * The reservoir's fill opacity. Low, because a 43 km2 block of solid colour would hide the
 * tambon alert levels underneath it, and those are what the map is for.
 */
export const RESERVOIR_FILL_OPACITY = 0.3;
export const RESERVOIR_LINE_WIDTH = 1.6;

/**
 * Does the dam's state get the river an extra emphasis? Only while water is confirmed to be
 * leaving above the turbine range. It is a thicker casing and nothing else: no new colour, and
 * never on its own - the notice says in words what the emphasis is about.
 */
export function emphasis(grade: string | null | undefined): boolean {
  return grade === "releasing";
}

/** The dashes on a tributary's lower reach, so it is never mistaken for the river itself. */
export const TRIBUTARY_DASH = [3, 1.5];

/**
 * The three marks a dam puts on the map, in drawing order, with the words on each.
 *
 * The dam's own mark carries its **name and nothing else**: it used to be the word "dam" plus
 * the name, and since the Thai name *is* "Bang Lang Dam" the map read it twice, wrapped over two
 * lines. The map calls this, so a test of it is a test of what is drawn.
 */
export type DamMark = {
  kind: "dam" | "spillway" | "outlet";
  point: { type: "Point"; coordinates: [number, number] } | null;
  label: string;
};

export function damMarks(
  dam: {
    code: string;
    name: Record<string, string>;
    point: DamMark["point"];
    spillwayPoint: DamMark["point"];
    outletPoint: DamMark["point"];
  },
  text: { spillway: string; outlet: string; locale: string },
): DamMark[] {
  const name =
    dam.name[text.locale] ?? dam.name.th ?? dam.name.en ?? Object.values(dam.name)[0] ?? dam.code;
  return [
    { kind: "dam", point: dam.point, label: name },
    { kind: "spillway", point: dam.spillwayPoint, label: text.spillway },
    { kind: "outlet", point: dam.outletPoint, label: text.outlet },
  ];
}
