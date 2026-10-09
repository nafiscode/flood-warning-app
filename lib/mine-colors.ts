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

/**
 * The colour of the nth watched place; it starts again from the top beyond the tenth. On the
 * dark map the lighter twin of the same colour is used, or the darkest pins disappear into it.
 */
export function mineColor(index: number, dark = false): string {
  const palette = dark ? MINE_COLORS_DARK : MINE_COLORS;
  return palette[index % palette.length]!;
}

/**
 * The same ten colours for the dark map (the owner, 10 Oct: their own pin was too dark to see
 * after sunset). Each is its light-theme colour mixed towards white, so a pin keeps its place
 * in the list and its hue, and still carries on a dark basemap. None of these is an alert hue
 * either; tests/unit/weather-pins.test.ts holds both palettes to that.
 */
export const MINE_COLORS_DARK = [
  "#AEE2DD",
  "#8099A8",
  "#92D1C9",
  "#9E8CBF",
  "#85C6C1",
  "#8D8FB4",
  "#CBB9E6",
  "#76A8B0",
  "#AF8DC4",
  "#7FB2AE",
] as const;

/**
 * The person's own home on the dark map. Not one of the ten, and not the near-black of the day
 * colour, which vanished into the night basemap.
 */
export const HOME_COLOR_DARK = "#A7D8F5";

/** The home's colour for the map as it is drawn now. */
export function homeColor(dark: boolean): string {
  return dark ? HOME_COLOR_DARK : HOME_COLOR;
}
