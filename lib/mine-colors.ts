/**
 * Colours for the places a person watches on the map (spec 4.9), one per place in the order they
 * were added, up to the ten places allowed.
 *
 * None of them is an alert hue. The alert palette (green #2F7A25, yellow #F2C230, orange #F07F1A,
 * red #C62828, blue #1F6FD1, grey #6B7780) belongs to alert levels alone (docs/brand.md), so
 * these stay in the cool teal-to-violet band, far from every one of them. They say which place a
 * pin is, never how dangerous it is: the level is in the pin's card and in the colour of the
 * tambon underneath.
 *
 * Colour is never the only way to tell the places apart, as it cannot be for someone who does not
 * see these hues: every pin carries its name, the person there and the address on hover or tap,
 * and the legend under the map lists them with their colour.
 */
export const MINE_COLORS = [
  // The order is measured, not guessed: each colour was chosen to be the most different from the
  // one before it, in lightness and in hue together, so two places added one after the other
  // never look alike. The weakest neighbouring pair (8 and 9) shares a lightness but is 91
  // degrees apart in hue; every other pair differs in both.
  "#7FD1C9", // brand teal light
  "#1D3B53", // brand slate
  "#46B3A6",
  "#5C3C8A", // violet
  "#2F9C95", // brand teal
  "#3B3F77", // indigo
  "#A98BD6", // lavender
  "#0E6A77", // deep teal
  "#7A3F9B", // purple
  "#1F7A74", // brand teal ink
] as const;

/** The person's own home, kept apart from the watched places by its own colour and a larger pin. */
export const HOME_COLOR = "#143044";

/** The colour of the nth watched place; it starts again from the top beyond the tenth. */
export function mineColor(index: number): string {
  return MINE_COLORS[index % MINE_COLORS.length]!;
}
