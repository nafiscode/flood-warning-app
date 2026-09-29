/**
 * Jaga color tokens (docs/brand.md). app/globals.css mirrors these as CSS variables;
 * tests/unit/brand-tokens.test.ts checks the two agree and that every pair passes contrast.
 *
 * Brand colors never show a status. Only the alert palette does, and always with icon + label.
 */

export const brand = {
  "jaga-slate": "#1D3B53",
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
