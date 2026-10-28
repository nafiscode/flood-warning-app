/**
 * The river-body layer on the map (pipeline/rivers): where water normally sits — rivers, canals,
 * reservoirs and lakes — as filled polygons drawn from OpenStreetMap.
 *
 * It comes as vector tiles in one PMTiles file on the public tile bucket, named by the same
 * `manifest.json` the hazard layer uses, so a new version needs no deploy. It is a **context**
 * layer, not a flood extent and never an all-clear (safety rule 10): it wears the map's water
 * colour (lib/dam-map.ts), the same the dam, the gauges and the sea wear, which by rule shows no
 * status — brand slate and teal never do, and neither does this. Data © OpenStreetMap, ODbL.
 */

import { DAM_WATER, DAM_WATER_DARK } from "@/lib/dam-map";
import { type TileManifest, tilesBase } from "@/lib/hazard-layer";

export const RIVER_LAYER = "river-body";
export const RIVER_SOURCE_LAYER = "river";

/** How solid the water is drawn: the streets and place names underneath stay readable. */
export const RIVER_OPACITY = 0.55;
export const RIVER_OPACITY_NIGHT = 0.5;

export { type TileManifest, tilesBase };

/** The water colour on the map as it is now — the dam's, the gauges' and the sea's own (lib/dam-map.ts). */
export function riverColor(dark: boolean): string {
  return dark ? DAM_WATER_DARK : DAM_WATER;
}

/** The `pmtiles://` address of the current river-body file, or null when the manifest names none. */
export function riverSourceUrl(base: string | null, manifest: TileManifest | null): string | null {
  const key = manifest?.layers?.[RIVER_LAYER]?.key;
  if (!base || !key || !/^[\w./-]+\.pmtiles$/.test(key) || key.includes("..")) return null;
  return `pmtiles://${base}/${key}`;
}
