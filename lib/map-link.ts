/**
 * Following a shared map link to the place it points at (the owner's request, 12 Oct).
 *
 * "Share" in Google Maps gives a short address such as maps.app.goo.gl/AbCd. The position is
 * not in it: only Google knows where it leads. So the server opens it for the person and reads
 * the position out of the address it is sent on to.
 *
 * A server that fetches an address somebody typed is a way into things it should never touch,
 * so this one is fenced: every hop must be a Google map host over https (isMapLinkHost), hops
 * are followed by hand and counted, nothing is ever sent but a plain GET, and the only thing
 * that comes back to the browser is a pair of numbers.
 */
import { coordinatesFromUrl, isMapLinkHost, type Point } from "@/lib/place-input";

const MAX_HOPS = 5;
const MAX_PAGE = 400_000;

export type Fetcher = (
  url: string,
) => Promise<{ status: number; location: string | null; text: () => Promise<string> }>;

function allowed(address: string): URL | null {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username !== "" || url.port !== "") return null;
  return isMapLinkHost(url.hostname) ? url : null;
}

/** A position written into the page itself, for the links whose last address has none. */
function inPage(html: string): Point | null {
  const slice = html.slice(0, MAX_PAGE);
  const direct = /https:\/\/(?:www\.)?google\.[a-z.]+\/maps\/[^"'\\\s<]+/gi;
  for (const found of slice.match(direct) ?? []) {
    const point = coordinatesFromUrl(found.replace(/\\u003d/g, "=").replace(/\\u0026/g, "&"));
    if (point) return point;
  }
  const centre = /center=(-?\d{1,3}\.\d+)(?:%2C|,)(-?\d{1,3}\.\d+)/i.exec(slice);
  if (centre) return coordinatesFromUrl(`https://www.google.com/maps?q=${centre[1]},${centre[2]}`);
  return null;
}

/**
 * The place a link leads to, or null when it cannot be told. `fetcher` is the network, passed
 * in so the fence can be tested without one.
 */
export async function resolveMapLink(address: string, fetcher: Fetcher): Promise<Point | null> {
  let current = allowed(address);
  for (let hop = 0; current && hop < MAX_HOPS; hop += 1) {
    const here = coordinatesFromUrl(current.href);
    if (here) return here;

    // A consent page in front of the map carries the real address in "continue".
    const onward = current.searchParams.get("continue");
    if (onward && current.hostname.startsWith("consent.")) {
      current = allowed(onward);
      continue;
    }

    const response = await fetcher(current.href);
    if (response.status >= 300 && response.status < 400 && response.location) {
      current = allowed(new URL(response.location, current).href);
      continue;
    }
    if (response.status === 200) return inPage(await response.text());
    return null;
  }
  return null;
}
