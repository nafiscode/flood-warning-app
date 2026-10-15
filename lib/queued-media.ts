/**
 * A9: photos and voice of a flood report that was sent without signal. The report itself goes out
 * through the offline queue (lib/queue.ts), from the page or the service worker; once it has an
 * id, its files are uploaded from here, because only the page holds the signed-in session that may
 * write them (report-media is private, RLS). A file that will not go after five tries, or a week,
 * is given up: the report itself has arrived.
 */
import { mediaReady, settleMedia, type QueuedMedia } from "@/lib/queue";
import { REPORT_BUCKET, uploadMedia } from "@/lib/upload";

export const MEDIA_MAX_TRIES = 5;
export const MEDIA_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Whether kept files are too old or tried too often to keep trying. */
export function giveUpOn(media: Pick<QueuedMedia, "tries" | "createdAt">, now: number): boolean {
  const age = now - Date.parse(media.createdAt);
  return media.tries >= MEDIA_MAX_TRIES || !(age < MEDIA_MAX_AGE_MS);
}

let running: Promise<number> | null = null;

/** Upload every kept file whose report has arrived. One run at a time. Returns how many settled. */
export function sendQueuedMedia(): Promise<number> {
  if (!running) {
    running = run().finally(() => {
      running = null;
    });
  }
  return running;
}

async function run(): Promise<number> {
  let settled = 0;
  for (const media of await mediaReady()) {
    if (giveUpOn(media, Date.now())) {
      await settleMedia(media.key, true);
      settled += 1;
      continue;
    }
    const id = media.reportId as string;
    try {
      const uploaded = await uploadMedia(REPORT_BUCKET, id, media.photos, media.voice);
      if (uploaded.photos.length > 0 || uploaded.voice) {
        const response = await fetch(`/api/report/${id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ photos: uploaded.photos, voice: uploaded.voice }),
          cache: "no-store",
        });
        if (!response.ok) throw new Error(String(response.status));
      }
      await settleMedia(media.key, uploaded.failed === 0);
      if (uploaded.failed === 0) settled += 1;
    } catch {
      await settleMedia(media.key, false);
    }
  }
  return settled;
}
