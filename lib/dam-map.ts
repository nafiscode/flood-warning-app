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

import { alert } from "@/lib/brand/tokens";
import type { DamLevel } from "@/lib/dam";

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
 * The dam's own three marks take the state's colour (the owner, 12 Oct). The water does not:
 * the river runs through 39 tambons whose alert colours lie underneath it, and a red line across
 * a green tambon would contradict the level a person issued there. A mark is a point at the dam,
 * so it says what the dam is doing without claiming anything about the places downstream.
 */
export function markColor(level: DamLevel, dark: boolean): string {
  if (level === "unknown") return dark ? DAM_MARK_DARK : DAM_MARK;
  // The alert palette is the same in both themes on purpose (docs/brand.md).
  return alert[level === "releasing" ? "evacuate" : level === "watch" ? "watch" : "normal"].bg;
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
/**
 * The reservoir lit up three times when somebody asks to be shown where it is (the owner,
 * 18 Oct 2026). Three slow pulses, about one every 1.2 seconds - far below the three flashes a
 * second that can harm a photosensitive reader - and for anyone who has asked for less motion it
 * is held lit once instead of blinking, for as long as the three would have taken.
 */
export const RESERVOIR_FLASH_TIMES = 3;
export const RESERVOIR_FLASH_MS = 600;
export const RESERVOIR_FLASH_OPACITY = 0.72;
export const RESERVOIR_FLASH_WIDTH = 4;
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

/**
 * The hatching of the dam's zone (lib/dam.ts, DamZone). A flat tint vanished over the flood-risk
 * colours (the owner, 14 Oct 2026), and a stronger tint would have hidden them. Diagonal lines
 * read over any colour and leave what is under them visible between the strokes. One image per
 * colour, so a change of theme gets its own.
 */
export const ZONE_HATCH_SIZE = 12;
export const ZONE_HATCH_RATIO = 2;

export function zoneHatchName(color: string): string {
  return `jaga-dam-hatch-${color.replace(/[^0-9a-z]/gi, "")}`;
}

/** A square that tiles: lines running up to the right, one every `ZONE_HATCH_SIZE` CSS pixels. */
export function zoneHatch(color: string): ImageData | null {
  if (typeof document === "undefined") return null;
  const side = ZONE_HATCH_SIZE * ZONE_HATCH_RATIO;
  const canvas = document.createElement("canvas");
  canvas.width = side;
  canvas.height = side;
  const c = canvas.getContext("2d");
  if (!c) return null;
  c.strokeStyle = color;
  c.lineWidth = 3;
  c.lineCap = "square";
  // Three strokes, so the ends meet across the edges when the square is repeated.
  for (const shift of [-side, 0, side]) {
    c.beginPath();
    c.moveTo(shift, side);
    c.lineTo(shift + side, 0);
    c.stroke();
  }
  return c.getImageData(0, 0, side, side);
}

/**
 * Rain over a reservoir (the owner, 21 Oct): the same clouds the person's own places get now
 * stand over each dam's lake, because heavy rain over the lake and the hills around it is what
 * raises the water behind the wall. The cloud only says what is falling; what the lake is doing
 * is the dam's own figures (safety rules 2 and 8).
 */
export const DAM_RAIN_PREFIX = "dam:";

/** The dam a reservoir cloud belongs to, or null when the id is not a reservoir's. */
export function damRainCode(id: string): string | null {
  return id.startsWith(DAM_RAIN_PREFIX) ? id.slice(DAM_RAIN_PREFIX.length) : null;
}

/**
 * Where the cloud goes: the middle of the lake's box, not its centre of area. The box is cheap
 * and steady, and a cloud is a sign held over a stretch of water - a few hundred metres either
 * way says nothing different. PostGIS hands over a Polygon or a MultiPolygon (lib/dam.ts), and
 * of a MultiPolygon the widest part is taken, which is the lake rather than a side arm.
 */
export function reservoirCentre(
  reservoir: {
    type: "Polygon" | "MultiPolygon";
    coordinates: number[][][] | number[][][][];
  } | null,
): { lat: number; lon: number } | null {
  if (!reservoir) return null;
  const rings: number[][][] =
    reservoir.type === "Polygon"
      ? [(reservoir.coordinates as number[][][])[0] ?? []]
      : (reservoir.coordinates as number[][][][]).map((part) => part[0] ?? []);
  let best: { lat: number; lon: number; span: number } | null = null;
  for (const ring of rings) {
    let west = Infinity;
    let east = -Infinity;
    let south = Infinity;
    let north = -Infinity;
    for (const point of ring) {
      const lon = point[0];
      const lat = point[1];
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
      west = Math.min(west, lon as number);
      east = Math.max(east, lon as number);
      south = Math.min(south, lat as number);
      north = Math.max(north, lat as number);
    }
    if (!Number.isFinite(west) || !Number.isFinite(south)) continue;
    const span = (east - west) * (north - south);
    if (best === null || span > best.span) {
      best = { lat: (south + north) / 2, lon: (west + east) / 2, span };
    }
  }
  return best ? { lat: best.lat, lon: best.lon } : null;
}

/**
 * One rain place per dam, over its lake; a dam with no reservoir mapped yet falls back to the
 * dam's own point, and one with neither contributes nothing.
 */
export function damRainPlaces(
  dams: {
    code: string;
    point: { type: "Point"; coordinates: [number, number] } | null;
    reservoir: {
      type: "Polygon" | "MultiPolygon";
      coordinates: number[][][] | number[][][][];
    } | null;
  }[],
): { id: string; lat: number; lon: number; home: boolean; reservoir: boolean }[] {
  const places: { id: string; lat: number; lon: number; home: boolean; reservoir: boolean }[] = [];
  for (const dam of dams) {
    const at =
      reservoirCentre(dam.reservoir) ??
      (dam.point ? { lat: dam.point.coordinates[1], lon: dam.point.coordinates[0] } : null);
    if (!at) continue;
    places.push({
      id: `${DAM_RAIN_PREFIX}${dam.code}`,
      lat: at.lat,
      lon: at.lon,
      home: false,
      reservoir: true,
    });
  }
  return places;
}
