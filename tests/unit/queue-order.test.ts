// @vitest-environment node
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enqueue, flush, pending } from "@/lib/queue";

/**
 * Safety rule 1, in the offline queue: a request for help is never delayed by anything else.
 *
 * A15 put a third kind in the queue, and that is what made this worth a test. Somebody with no
 * signal can rate the app at ten past and press SOS at twenty past; strict time order - what the
 * queue did before - would have spent the first round trip of a recovered connection on the
 * rating. The bands fix the order between kinds, and inside a band it is still oldest first,
 * which is what keeps a detail step behind the SOS it belongs to.
 */
const SOS = { lat: 6.88, lon: 101.27 };
const RATING = { rating: 4, liked: ["risk_map"] };

async function freshQueue() {
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase("jaga-queue");
    request.onsuccess = request.onerror = request.onblocked = () => resolve();
  });
}

describe("the offline queue's order", () => {
  beforeEach(freshQueue);
  afterEach(() => vi.unstubAllGlobals());

  it("sends a request for help before a rating queued earlier", async () => {
    const rating = await enqueue("feedback", "/api/feedback", RATING);
    const sos = await enqueue("sos", "/api/sos", SOS);
    expect((await pending()).map((p) => p.key)).toEqual([sos, rating]);
  });

  it("puts a report ahead of a rating, and both behind a request for help", async () => {
    const rating = await enqueue("feedback", "/api/feedback", RATING);
    const report = await enqueue("report", "/api/report", SOS);
    const sos = await enqueue("sos", "/api/sos", SOS);
    expect((await pending()).map((p) => p.kind)).toEqual(["sos", "report", "feedback"]);
    expect((await pending()).map((p) => p.key)).toEqual([sos, report, rating]);
  });

  it("keeps a case's own steps in the order they were made", async () => {
    const sos = await enqueue("sos", "/api/sos", SOS);
    const details = await enqueue("sos-details", "/api/sos/1", {});
    const location = await enqueue("sos-location", "/api/sos/1", {});
    expect((await pending()).map((p) => p.key)).toEqual([sos, details, location]);
  });

  it("really sends them in that order when the connection comes back", async () => {
    await enqueue("feedback", "/api/feedback", RATING);
    await enqueue("sos", "/api/sos", SOS);
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        urls.push(url);
        return Promise.resolve(new Response("{}", { status: 200 }));
      }),
    );
    const result = await flush();
    expect(result.sent).toBe(2);
    expect(urls).toEqual(["/api/sos", "/api/feedback"]);
  });
});
