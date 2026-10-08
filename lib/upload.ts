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
    if (await put(storage, path, small.blob, small.type)) done.push(path);
    else failed += 1;
  }

  let voicePath: string | null = null;
  if (voice) {
    const path = `${id}/voice.${voice.extension}`;
    if (await put(storage, path, voice.blob, voice.blob.type || undefined)) voicePath = path;
    else failed += 1;
  }
  return { photos: done, voice: voicePath, failed };
}

type Bucket = ReturnType<ReturnType<typeof createClient>["storage"]["from"]>;

/**
 * One file. Not an upsert: Storage's overwrite path needs rights a visitor sending an anonymous
 * SOS does not have (tried against jaga-dev: "new row violates row-level security policy"), and
 * the paths are fixed, so a second attempt means the file is already there - which is a success,
 * not a failure.
 */
async function put(
  storage: Bucket,
  path: string,
  blob: Blob,
  contentType?: string,
): Promise<boolean> {
  const { error } = await storage.upload(path, blob, { contentType, upsert: false });
  if (!error) return true;
  const already =
    (error as { statusCode?: string | number }).statusCode === 409 ||
    (error as { statusCode?: string | number }).statusCode === "409" ||
    /exists/i.test(error.message);
  return already;
}
