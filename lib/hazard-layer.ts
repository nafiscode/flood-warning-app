/**
 * The flood-hazard classes on the map (science plan Module 1; decisions of 12 Oct 2026).
 *
 * The classes come as vector tiles in one PMTiles file on the public tile bucket; `manifest.json`
 * there names the current file, so a new version needs no deploy. Three classes are drawn, light
 * to dark: pale pink, rose and deep wine-red (the owner, 12 Oct 2026: it should look like a risk
 * map and be see-through). They are warm on purpose and are **not** the yellow, orange and red of
 * Watch, Warning and Evacuate: each one was measured against the alert palette and sits clearly
 * apart from it, so a class cannot be read as an alert level, and each class is also named in
 * words wherever it is shown. The lowest class is not
 * in the tiles at all: a place without colour is "minimal" or outside the four provinces, never
 * "no risk", and the note under the map says so (safety rule 10).
 */

export const HAZARD_LAYER = "flood-classes";
export const HAZARD_SOURCE_LAYER = "hazard";

/** Highest first, as a legend reads. `value` is the `class` property in the tiles. */
export const HAZARD_CLASSES = [
  { value: 4, key: "high", color: "#7A1238", night: "#FFC4D6" },
  { value: 3, key: "medium", color: "#DB6A9A", night: "#E0679E" },
  { value: 2, key: "low", color: "#F2B8C6", night: "#7E5C74" },
] as const;
/** How solid the classes are drawn: the streets and place names underneath stay readable. */
export const HAZARD_OPACITY = 0.45;
export const HAZARD_OPACITY_NIGHT = 0.6;

/**
 * The colour of a class on the map as it is now. On the dark map the order of lightness is turned
 * round (the owner, 13 Oct 2026): by day the highest class is the darkest, and on a dark ground
 * that made it the hardest to see, the wrong way round for the class that matters most. At night
 * the highest class is the brightest and the lowest a dim mauve. Same family of pinks, still clear
 * of every alert colour, and the legend always shows the colours the map is using.
 */
export function hazardColor(c: (typeof HAZARD_CLASSES)[number], dark: boolean): string {
  return dark ? c.night : c.color;
}
export type HazardKey = (typeof HAZARD_CLASSES)[number]["key"];

export type TileManifest = { layers?: Record<string, { key?: string; updated?: string }> };

/** Where the tiles live, from the public setting; null when the app has no tile bucket. */
export function tilesBase(): string | null {
  const base = (process.env.NEXT_PUBLIC_TILES_BASE_URL ?? "").trim().replace(/\/+$/, "");
  return /^https?:\/\//.test(base) ? base : null;
}

/** The `pmtiles://` address of the current hazard file, or null when the manifest names none. */
export function hazardSourceUrl(base: string | null, manifest: TileManifest | null): string | null {
  const key = manifest?.layers?.[HAZARD_LAYER]?.key;
  if (!base || !key || !/^[\w./-]+\.pmtiles$/.test(key) || key.includes("..")) return null;
  return `pmtiles://${base}/${key}`;
}

/** The class a tile feature carries, as a key; null for anything the legend does not name. */
export function hazardKey(value: unknown): HazardKey | null {
  return HAZARD_CLASSES.find((c) => c.value === Number(value))?.key ?? null;
}

/** MapLibre's fill-color: one colour per class, nothing for anything else. */
export function hazardFillColor(dark = false): unknown[] {
  return [
    "match",
    ["get", "class"],
    ...HAZARD_CLASSES.flatMap((c) => [c.value, hazardColor(c, dark)]),
    "rgba(0,0,0,0)",
  ];
}
