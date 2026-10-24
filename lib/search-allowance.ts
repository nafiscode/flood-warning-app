/**
 * How often one address may ask the place search a question without an account (the owner, 24 Oct
 * 2026: the box for visitors found nothing but tambons). OpenStreetMap asks for no more than a
 * request a second from a service, and a shared cloud address that asks too often is the one it
 * turns away, so a visitor gets a handful of searches a minute. Best effort: it is kept in the
 * memory of one server instance, which is enough to stop a loop in a browser or a script, not a
 * determined attacker; the services' answers are also kept for a day (app/api/geo/search).
 * Never used for anyone signed in, and never on an SOS: this box is an extra way to say where.
 */
const WINDOW_MS = 60_000;
const MOST = 12;
const seen = new Map<string, number[]>();

export function allowSearch(address: string, now = Date.now()): boolean {
  const recent = (seen.get(address) ?? []).filter((at) => now - at < WINDOW_MS);
  if (recent.length >= MOST) {
    seen.set(address, recent);
    return false;
  }
  recent.push(now);
  seen.set(address, recent);
  // Forget addresses that went quiet, so the map cannot grow without end.
  if (seen.size > 5_000) {
    for (const [key, times] of seen) {
      if (times.every((at) => now - at >= WINDOW_MS)) seen.delete(key);
    }
  }
  return true;
}

/** Test seam. */
export function forgetSearches() {
  seen.clear();
}
