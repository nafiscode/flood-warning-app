/**
 * Wait for a quiet moment before asking for something that is not the news.
 *
 * The home screen's hero, its checklist and the SOS button come first on a slow phone: a figure
 * that is nice to have must never compete with them for a 3G connection. Everything that uses
 * this is a background figure by definition.
 */
export function whenIdle(run: () => void): () => void {
  type WithIdle = Window & {
    requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number;
    cancelIdleCallback?: (handle: number) => void;
  };
  const w = window as WithIdle;
  if (w.requestIdleCallback) {
    const handle = w.requestIdleCallback(run, { timeout: 3_000 });
    return () => w.cancelIdleCallback?.(handle);
  }
  const timer = window.setTimeout(run, 1_500);
  return () => window.clearTimeout(timer);
}
