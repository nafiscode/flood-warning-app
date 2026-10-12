/**
 * The markers of the safe places on the map: a rounded square with a small house (a place for
 * people) or a P (high ground for cars).
 *
 * Square on purpose. The person's own home and watched places are round pins in their own colours;
 * a round dot for the safe places as well made the two almost the same thing at a glance (the
 * owner, 12 Oct 2026). Shape tells them apart before colour does, which also holds for anyone who
 * does not see the colours.
 */

export type PlaceIconKind = "place" | "parking";

/** Side of the marker in CSS pixels; drawn at twice that for sharp screens. */
export const PLACE_ICON_SIZE = 26;
export const PLACE_ICON_RATIO = 2;

/** The image's name on the map: one per kind and per ink, so a change of theme gets its own. */
export function placeIconName(kind: PlaceIconKind, ink: string): string {
  return `jaga-${kind}-${ink.replace(/[^0-9a-z]/gi, "")}`;
}

/** Corner points of the little house, in units of the marker's side (0..1). */
export const HOUSE: [number, number][] = [
  [0.5, 0.2],
  [0.82, 0.48],
  [0.72, 0.48],
  [0.72, 0.78],
  [0.28, 0.78],
  [0.28, 0.48],
  [0.18, 0.48],
];

/**
 * Draw one marker. Browser only (it needs a canvas); returns null where there is none, and the map
 * then simply has no picture for that layer instead of failing.
 */
export function placeIcon(kind: PlaceIconKind, ink: string, halo: string): ImageData | null {
  if (typeof document === "undefined") return null;
  const side = PLACE_ICON_SIZE * PLACE_ICON_RATIO;
  const canvas = document.createElement("canvas");
  canvas.width = side;
  canvas.height = side;
  const c = canvas.getContext("2d");
  if (!c) return null;
  const edge = 3;
  const radius = 9;
  c.beginPath();
  c.roundRect(edge, edge, side - 2 * edge, side - 2 * edge, radius);
  c.fillStyle = ink;
  c.fill();
  c.lineWidth = edge;
  c.strokeStyle = halo;
  c.stroke();
  c.fillStyle = halo;
  if (kind === "parking") {
    c.font = `700 ${Math.round(side * 0.62)}px system-ui, sans-serif`;
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText("P", side / 2, side / 2 + 2);
  } else {
    c.beginPath();
    HOUSE.forEach(([x, y], i) =>
      i === 0 ? c.moveTo(x * side, y * side) : c.lineTo(x * side, y * side),
    );
    c.closePath();
    c.fill();
  }
  return c.getImageData(0, 0, side, side);
}
