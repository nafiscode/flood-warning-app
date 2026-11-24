/**
 * Hat Yai flood cameras (owner, 24 Nov 2026: "Build it - embed, Hat Yai only").
 *
 * Unlike lib/cctv.ts (which only links out), these are live JPEGs Jaga shows in-app. Hatyai City
 * Climate (SCCCRN, a community flood-watch running since 2009, content under CC BY-SA 3.0) gathers
 * official Department of Water Resources cameras and sponsor-funded ones along the U-Tapao canal
 * system. Each frame carries a burned-in capture time and, at most points, a water-level staff
 * gauge, so a frozen or offline camera reads as stale on its own face (safety rules 8 and 10). A
 * camera is never a Jaga alert and never an all-clear (safety rule 2).
 *
 * The site's page cannot be framed (X-Frame-Options: SAMEORIGIN), but each camera's newest frame is
 * a static JPEG at `floodphoto/last/<image>.jpg`, served Access-Control-Allow-Origin: * and
 * overwritten about once a minute, so an <img> can show it directly. Only the seven coded SCCCRN
 * stations serve this path; the radar, satellite and test feeds on the same site do not, and are
 * left out. Verified live on 24 Nov 2026 (all seven fresh to the minute).
 *
 * Jaga stores nothing: the browser loads each image straight from their server, only while the
 * window is open, and refreshes only when the viewer asks (politeness to a community project's
 * bandwidth). Credit stays on screen and the source page is one tap away.
 */
export interface HatYaiCam {
  /** SCCCRN station code, shown on the card (e.g. "S1"). */
  readonly code: string;
  /** Image basename under floodphoto/last/. */
  readonly image: string;
}

/** The seven coded SCCCRN stations that serve a live frame. Order roughly upstream to downstream. */
export const HATYAI_CAMS: readonly HatYaiCam[] = [
  { code: "S8", image: "hatyainai" },
  { code: "S9", image: "road30m" },
  { code: "S2", image: "bangsala" },
  { code: "S1", image: "muangkong" },
  { code: "S6", image: "klongwha" },
  { code: "S7", image: "klongwha2" },
  { code: "S4", image: "patongkn" },
];

/** The project's own public page, opened in a new window for the full set and the archive. */
export const HATYAI_SOURCE_URL = "https://www.hatyaicityclimate.org/";

const IMAGE_BASE = "https://hatyaicityclimate.org/floodphoto/last/";

/** The live JPEG for a camera. `bust` (a timestamp) forces the newest frame past the browser cache. */
export function hatYaiCamImage(image: string, bust?: number): string {
  return `${IMAGE_BASE}${image}.jpg${bust ? `?t=${bust}` : ""}`;
}

/** i18n key (under `hatyaiCams.cams`) for a camera's place name. */
export function hatYaiCamNameKey(code: string): string {
  return code.toLowerCase();
}

/**
 * The Hat Yai / U-Tapao basin, where these cameras sit. The cameras window is offered on a gauge
 * card only when the gauge falls in this box, so it never shows on a Songkhla gauge far from Hat Yai
 * (owner: "Hat Yai only"). A generous box around the city and the canal below it.
 */
export const HATYAI_BBOX = {
  minLat: 6.85,
  maxLat: 7.12,
  minLon: 100.3,
  maxLon: 100.64,
} as const;

export function inHatYai(lat: number, lon: number): boolean {
  return (
    lat >= HATYAI_BBOX.minLat &&
    lat <= HATYAI_BBOX.maxLat &&
    lon >= HATYAI_BBOX.minLon &&
    lon <= HATYAI_BBOX.maxLon
  );
}
