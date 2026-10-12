/**
 * The flood-hazard classes on the map (science plan Module 1; decisions of 12 Oct 2026).
 *
 * The classes come as vector tiles in one PMTiles file on the public tile bucket; `manifest.json`
 * there names the current file, so a new version needs no deploy. Three classes are drawn, in three
 * shades of one purple, light to dark. Purple is no alert colour, so a class can never be read as an
 * alert level, and each class is also named in words wherever it is shown. The lowest class is not
 * in the tiles at all: a place without colour is "minimal" or outside the four provinces, never
 * "no risk", and the note under the map says so (safety rule 10).
 */

export const HAZARD_LAYER = "flood-classes";
export const HAZARD_SOURCE_LAYER = "hazard";

/** Highest first, as a legend reads. `value` is the `class` property in the tiles. */
export const HAZARD_CLASSES = [
  { value: 4, key: "high", color: "#5A2A8C" },
  { value: 3, key: "medium", color: "#9A6BCB" },
  { value: 2, key: "low", color: "#C9B1E8" },
] as const;
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
export function hazardFillColor(): unknown[] {
  return [
    "match",
    ["get", "class"],
    ...HAZARD_CLASSES.flatMap((c) => [c.value, c.color]),
    "rgba(0,0,0,0)",
  ];
}
