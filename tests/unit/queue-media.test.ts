// @vitest-environment node
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { giveUpOn, MEDIA_MAX_AGE_MS, MEDIA_MAX_TRIES } from "@/lib/queued-media";
import { enqueue, flush, mediaReady, pending, settleMedia } from "@/lib/queue";

const BODY = { lat: 6.88, lon: 101.27, depth: "knee", trend: null, roadAccess: null, text: null };
const photo = () => new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" });

function answer(status: number, body: unknown = {}) {
  return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

describe("a report queued offline keeps its photos and voice (A9)", () => {
  beforeEach(async () => {
    // A fresh database for each test.
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase("jaga-queue");
      request.onsuccess = request.onerror = request.onblocked = () => resolve();
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("keeps the files beside the queued report, not ready before it has an id", async () => {
    const key = await enqueue("report", "/api/report", BODY, {
      photos: [photo(), photo()],
      voice: { blob: photo(), extension: "webm" },
    });
    expect(key).not.toBeNull();
    expect((await pending()).map((p) => p.key)).toEqual([key]);
    expect(await mediaReady()).toEqual([]);
  });

  it("once the report is delivered, its files carry the report's id and are ready to upload", async () => {
    const key = await enqueue("report", "/api/report", BODY, { photos: [photo()], voice: null });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => answer(200, { id: "rep-123" })),
    );
    const result = await flush();
    expect(result.sent).toBe(1);
    const ready = await mediaReady();
    expect(ready).toHaveLength(1);
    expect(ready[0]!.key).toBe(key);
    expect(ready[0]!.reportId).toBe("rep-123");
    expect(ready[0]!.photos).toHaveLength(1);
  });

  it("a report without files keeps no media record", async () => {
    await enqueue("report", "/api/report", BODY, { photos: [], voice: null });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => answer(200, { id: "rep-9" })),
    );
    await flush();
    expect(await mediaReady()).toEqual([]);
  });

  it("uploaded files are forgotten; a failed try is counted", async () => {
    const key = (await enqueue("report", "/api/report", BODY, { photos: [photo()], voice: null }))!;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => answer(200, { id: "rep-1" })),
    );
    await flush();
    await settleMedia(key, false);
    expect((await mediaReady())[0]!.tries).toBe(1);
    await settleMedia(key, true);
    expect(await mediaReady()).toEqual([]);
  });

  it("gives up after five tries or a week, never on a fresh one", () => {
    const now = Date.parse("2026-10-15T00:00:00Z");
    const fresh = new Date(now - 60_000).toISOString();
    expect(giveUpOn({ tries: 0, createdAt: fresh }, now)).toBe(false);
    expect(giveUpOn({ tries: MEDIA_MAX_TRIES, createdAt: fresh }, now)).toBe(true);
    expect(
      giveUpOn({ tries: 0, createdAt: new Date(now - MEDIA_MAX_AGE_MS - 1).toISOString() }, now),
    ).toBe(true);
  });
});
