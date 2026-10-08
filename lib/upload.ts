"use client";

import { compressImage, MAX_PHOTOS } from "@/lib/media";
import { createClient } from "@/lib/supabase/browser";

/**
 * Putting photos and a voice note in Storage, from the phone.
 *
 * Both buckets are private: a path is not a link, and only the reporter, a covering verified
 * authority or an admin can read it (safety rules 5 and 6). Everything is stored under the case
 * or report id, which is what the storage policies check.
 *
 * Media is never a reason for an SOS to fail: the request is sent first, the pictures follow, and
 * an upload that does not work is reported on its own.
 */
export const SOS_BUCKET = "sos-media";
export const REPORT_BUCKET = "report-media";

export type Uploaded = { photos: string[]; voice: string | null; failed: number };

type Voice = { blob: Blob; extension: string } | null;

export async function uploadMedia(
  bucket: typeof SOS_BUCKET | typeof REPORT_BUCKET,
  id: string,
  photos: Blob[],
  voice: Voice = null,
): Promise<Uploaded> {
  const done: string[] = [];
  let failed = 0;
  if (photos.length === 0 && !voice) return { photos: done, voice: null, failed };

  const storage = createClient().storage.from(bucket);
  for (const [index, photo] of photos.slice(0, MAX_PHOTOS).entries()) {
    const small = await compressImage(photo);
    const path = `${id}/photo-${index + 1}.jpg`;
    const { error } = await storage.upload(path, small.blob, {
      contentType: small.type,
      upsert: true,
    });
    if (error) failed += 1;
    else done.push(path);
  }

  let voicePath: string | null = null;
  if (voice) {
    const path = `${id}/voice.${voice.extension}`;
    const { error } = await storage.upload(path, voice.blob, {
      contentType: voice.blob.type || undefined,
      upsert: true,
    });
    if (error) failed += 1;
    else voicePath = path;
  }
  return { photos: done, voice: voicePath, failed };
}
