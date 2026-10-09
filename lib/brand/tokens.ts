/**
 * Jaga color tokens (docs/brand.md). app/globals.css mirrors these as CSS variables;
 * tests/unit/brand-tokens.test.ts checks the two agree and that every pair passes contrast.
 *
 * Brand colors never show a status. Only the alert palette does, and always with icon + label.
 */

export const brand = {
  "jaga-slate": "#1D3B53",
  /*
   * Two roles the slate used to play alone, split so the app can go dark (9 Oct). In the light
   * theme both are the brand slate, so nothing changes by day; in the dark theme "ink" (headings
   * and strong words) turns light while "slate" stays a filled navy for the header and the
   * primary button, and "edge" is the outline of a button or chip that must still be seen.
   */
  "jaga-ink": "#1D3B53",
  "jaga-edge": "#1D3B53",
  "jaga-teal": "#2F9C95",
  "jaga-teal-ink": "#1F7A74",
  "jaga-teal-light": "#7FD1C9",
  "jaga-ground": "#F0F2EE",
  "jaga-surface": "#FFFFFF",
  "jaga-text": "#1A3040",
  "jaga-text-2": "#4A5E68",
  "jaga-line": "#D5DCD8",
} as const;

/** Alert levels in escalation order, plus "return" (safe to go home). */
export const ALERT_LEVELS = ["normal", "watch", "warning", "evacuate", "return"] as const;
export type AlertLevel = (typeof ALERT_LEVELS)[number];

/** Background and text color for each level badge, the stale marker and the SOS button. */
export const alert = {
  normal: { bg: "#2F7A25", fg: "#FFFFFF" },
  watch: { bg: "#F2C230", fg: "#1A1A1A" },
  warning: { bg: "#F07F1A", fg: "#1A1A1A" },
  evacuate: { bg: "#C62828", fg: "#FFFFFF" },
  return: { bg: "#1F6FD1", fg: "#FFFFFF" },
  stale: { bg: "#6B7780", fg: "#FFFFFF" },
  sos: { bg: "#C62828", fg: "#FFFFFF" },
} as const;

/**
 * The same tokens after sunset (the owner's note, 9 Oct). The hues are the brand's, only
 * lightness moves: the page goes deep slate, text goes near-white, and the links and outlines
 * take the lighter teal so they can still be seen. The alert palette is deliberately absent:
 * those colours mean a level and are kept exactly as they are in both themes (docs/brand.md),
 * and every badge carries its own background, so it reads on a dark page as well as a light one.
 */
export const darkBrand = {
  "jaga-slate": "#1F3C56",
  "jaga-ink": "#EAF1F4",
  "jaga-edge": "#7FA3B5",
  "jaga-teal": "#35B3AA",
  "jaga-teal-ink": "#7FD1C9",
  "jaga-teal-light": "#A9E3DC",
  "jaga-ground": "#0F1C26",
  "jaga-surface": "#16242F",
  "jaga-text": "#E6EDF1",
  "jaga-text-2": "#A8BCC6",
  "jaga-line": "#2C4150",
} as const;

/** Text/background pairs used in the UI. Normal text needs 4.5:1. */
export const contrastPairs: { name: string; fg: string; bg: string }[] = [
  { name: "body text on ground", fg: brand["jaga-text"], bg: brand["jaga-ground"] },
  { name: "body text on surface", fg: brand["jaga-text"], bg: brand["jaga-surface"] },
  { name: "secondary text on ground", fg: brand["jaga-text-2"], bg: brand["jaga-ground"] },
  { name: "secondary text on surface", fg: brand["jaga-text-2"], bg: brand["jaga-surface"] },
  { name: "teal-ink link on ground", fg: brand["jaga-teal-ink"], bg: brand["jaga-ground"] },
  { name: "teal-ink link on surface", fg: brand["jaga-teal-ink"], bg: brand["jaga-surface"] },
  { name: "white on slate (header, primary button)", fg: "#FFFFFF", bg: brand["jaga-slate"] },
  { name: "teal-light on slate", fg: brand["jaga-teal-light"], bg: brand["jaga-slate"] },
  ...Object.entries(alert).map(([level, c]) => ({
    name: `${level} badge label`,
    fg: c.fg,
    bg: c.bg,
  })),
];

/** The same checks after sunset. A badge keeps its own colours, so it is checked once above. */
export const darkContrastPairs: { name: string; fg: string; bg: string }[] = [
  { name: "dark: body text on ground", fg: darkBrand["jaga-text"], bg: darkBrand["jaga-ground"] },
  { name: "dark: body text on surface", fg: darkBrand["jaga-text"], bg: darkBrand["jaga-surface"] },
  {
    name: "dark: secondary text on ground",
    fg: darkBrand["jaga-text-2"],
    bg: darkBrand["jaga-ground"],
  },
  {
    name: "dark: secondary text on surface",
    fg: darkBrand["jaga-text-2"],
    bg: darkBrand["jaga-surface"],
  },
  { name: "dark: heading on ground", fg: darkBrand["jaga-ink"], bg: darkBrand["jaga-ground"] },
  { name: "dark: heading on surface", fg: darkBrand["jaga-ink"], bg: darkBrand["jaga-surface"] },
  { name: "dark: link on ground", fg: darkBrand["jaga-teal-ink"], bg: darkBrand["jaga-ground"] },
  { name: "dark: link on surface", fg: darkBrand["jaga-teal-ink"], bg: darkBrand["jaga-surface"] },
  {
    name: "dark: white on slate (header, primary button)",
    fg: "#FFFFFF",
    bg: darkBrand["jaga-slate"],
  },
  {
    name: "dark: teal-light on slate",
    fg: darkBrand["jaga-teal-light"],
    bg: darkBrand["jaga-slate"],
  },
  // An outline is not text, but it has to be seen: 3:1 is the bar for a control's edge.
  { name: "dark: outline on ground", fg: darkBrand["jaga-edge"], bg: darkBrand["jaga-ground"] },
  { name: "dark: outline on surface", fg: darkBrand["jaga-edge"], bg: darkBrand["jaga-surface"] },
];
