/**
 * A9: what the phone keeps ready for a visit with no signal (safety rule 7). After a page has
 * loaded and the phone is idle, the app asks its service worker to fetch these into the page cache,
 * so home, SOS, food and water and the map open in airplane mode even if the person never visited
 * them. Map tiles are not in this list on purpose: OpenFreeMap's terms forbid bulk downloads that
 * the person did not start, so tiles are kept only as the person views them (decision 15 Oct 2026).
 * Import-free, so the service worker and the page can both use it.
 */

export type WarmLocale = "th" | "ms" | "en";

/** The service worker's message type, and the cache the warmed copies go into. */
export const WARM_MESSAGE = "jaga-warm";
/** Sent by the sign-out form: the worker forgets every cached copy that could be personal. */
export const SIGN_OUT_MESSAGE = "jaga-sign-out";
export const PAGES_CACHE = "pages-html";
export const PUBLIC_DATA_CACHE = "jaga-public-data";

/** Once a day is enough: the pages change only with a deploy, the area list hardly ever. */
export const WARM_EVERY_MS = 24 * 60 * 60 * 1000;

/** Pages that must open without signal. /report is left out: it needs a signed-in session. */
const PAGES = ["/", "/sos", "/supplies", "/map"] as const;

/** Public answers worth having offline before the first need: the area list behind "choose your area" on the SOS screen. */
const DATA = ["/api/geo/areas"] as const;

export function localePrefix(locale: WarmLocale): string {
  return locale === "th" ? "" : `/${locale}`;
}

/** The addresses to keep ready for one language (Thai has no prefix: as-needed routing). */
export function warmUrls(locale: WarmLocale): string[] {
  const p = localePrefix(locale);
  return [...PAGES.map((path) => (path === "/" ? p || "/" : `${p}${path}`)), ...DATA];
}

/** Whether a warm-up is due, given when the last one finished (ms since epoch, or null). */
export function warmDue(last: number | null, now: number): boolean {
  return last === null || !Number.isFinite(last) || now - last >= WARM_EVERY_MS || now < last;
}

/**
 * Public, same-for-everyone answers the service worker may keep, so the map's outlines, colours
 * and safe places and the SOS area list still draw offline. Personal answers never match.
 */
const PUBLIC_DATA_PATHS = new Set([
  "/api/geo/areas",
  "/api/geo/tambons",
  "/api/geo/provinces",
  "/api/public/map",
  "/api/public/hazards",
  "/api/public/gauges",
]);

export function isPublicData(pathname: string): boolean {
  return PUBLIC_DATA_PATHS.has(pathname);
}

/**
 * Map files kept as the person views them. Tiles are kept for a month (their addresses carry a
 * version, so a new map comes as new files); styles and tile indexes are asked for first and kept
 * only for offline. Esri is left out: its terms allow no caching beyond what its own headers say.
 */
export type MapAsset = "tile" | "style" | null;

const TILE_HOSTS = new Set([
  "tiles.openfreemap.org",
  "tiles.maps.eox.at",
  "elevation-tiles-prod.s3.amazonaws.com",
]);

export function mapAsset(url: URL): MapAsset {
  if (!TILE_HOSTS.has(url.hostname)) return null;
  if (/\.(pbf|mvt|png|jpe?g|webp)$/i.test(url.pathname)) return "tile";
  return "style";
}

/** Which language's offline page to show for a path that could not load. */
export function offlinePageFor(pathname: string): string {
  const m = /^\/(ms|en)(?:\/|$)/.exec(pathname);
  return m ? `/${m[1]}/offline` : "/offline";
}
