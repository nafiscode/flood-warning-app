/**
 * Official, agency-run live CCTV portals for the service area.
 *
 * Jaga never hosts, re-serves or proxies these images: the camera window links out to the agency's
 * own site (owner, 22 Nov 2026). The search for a free API, MCP or embeddable feed found none that
 * carries a verifiable per-frame capture time, and the one real flood-camera network - DDPM's
 * `cctv.disaster.go.th` - forbids being shown inside a frame (`X-Frame-Options: SAMEORIGIN`,
 * `Content-Security-Policy: frame-ancestors 'self'`). So every source here is `embeddable: false`
 * and opens in the agency's own window.
 *
 * Flip a source to `embeddable: true` ONLY once its page is confirmed both to permit framing AND to
 * show a capture time on each frame, so a frozen or offline camera can never read as a live one
 * (safety rules 8 and 10). A camera is never an alert and never an all-clear (safety rule 2).
 *
 * This is the single place the URLs live - correct them here. Both were last reachable as JS apps
 * that render in a browser; EGAT's hosts answered a bare request with 500 on 22 Nov 2026, so the
 * owner should confirm each page loads and actually shows cameras for our provinces.
 */
export type CctvSourceId = "riverGauge" | "dam";

export interface CctvSource {
  /** The agency's own public live-camera page, opened in a new window. */
  readonly url: string;
  /** i18n key under the `cctv` namespace for the agency's name. */
  readonly nameKey: string;
  /** Whether the page may be shown inside an in-app iframe. See the note above: keep this false
   *  until a page is proven framable and timestamped. */
  readonly embeddable: boolean;
}

export const CCTV_SOURCES: Record<CctvSourceId, CctvSource> = {
  // DDPM's national disaster-CCTV network: the live flood cameras. Refuses to be framed.
  riverGauge: {
    url: "https://cctv.disaster.go.th/",
    nameKey: "sourceDdpm",
    embeddable: false,
  },
  // EGAT runs Bang Lang (our dam) and its sister dams; its public water portal carries the dam-site
  // readings and cameras. The `RealTimeCCTV` path was 500 on 22 Nov 2026, so we point at the stable
  // water portal and let the operator's own site route to its cameras.
  dam: {
    url: "https://water.egat.co.th/",
    nameKey: "sourceEgat",
    embeddable: false,
  },
};
