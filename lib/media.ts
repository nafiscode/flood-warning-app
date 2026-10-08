/**
 * Photos and voice notes from a phone, for reports and SOS details.
 *
 * Everything is made small on the phone before it is sent: a flood is exactly when the network is
 * worst, and the budget guardrails ask for it (CLAUDE.md): longest side 1600 px, JPEG quality
 * about 0.7, voice notes of 60 s or less. Safari and Chrome record different audio formats, so
 * the recorder asks the browser what it can do instead of assuming webm.
 */
export const MAX_PHOTOS = 3;
export const MAX_SIDE = 1600;
export const JPEG_QUALITY = 0.7;
export const MAX_VOICE_SECONDS = 60;

export type Compressed = { blob: Blob; type: string; width: number; height: number };

/**
 * Shrink and re-encode one picture. If anything about the browser's canvas or the file is not
 * what we expect, the original is sent instead: a smaller photo is better, no photo is worse.
 */
export async function compressImage(file: Blob): Promise<Compressed> {
  const fallback: Compressed = { blob: file, type: file.type || "image/jpeg", width: 0, height: 0 };
  if (typeof document === "undefined") return fallback;
  try {
    const bitmap = await loadBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return fallback;
    context.drawImage(bitmap, 0, 0, width, height);
    if ("close" in bitmap) bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
    );
    if (!blob) return fallback;
    return { blob, type: "image/jpeg", width, height };
  } catch {
    return fallback;
  }
}

async function loadBitmap(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    // The phone's own rotation is applied here, so a portrait photo is not sent sideways.
    return createImageBitmap(file, { imageOrientation: "from-image" });
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("the picture could not be read"));
      image.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** The audio format this browser can record: Chrome gives webm/opus, Safari mp4/aac. */
export function voiceFormat(): { mimeType: string; extension: string } | null {
  if (typeof MediaRecorder === "undefined") return null;
  const candidates: [string, string][] = [
    ["audio/webm;codecs=opus", "webm"],
    ["audio/webm", "webm"],
    ["audio/mp4;codecs=mp4a.40.2", "m4a"],
    ["audio/mp4", "m4a"],
    ["audio/ogg;codecs=opus", "ogg"],
    ["audio/mpeg", "mp3"],
  ];
  for (const [mimeType, extension] of candidates) {
    if (MediaRecorder.isTypeSupported(mimeType)) return { mimeType, extension };
  }
  // Some Safari builds record without saying which types they support.
  return { mimeType: "", extension: "m4a" };
}

/** What a finished recording is stored as: audio/mp4 for an .m4a, and so on. */
export function voiceContentType(extension: string): string {
  if (extension === "webm") return "audio/webm";
  if (extension === "ogg") return "audio/ogg";
  if (extension === "mp3") return "audio/mpeg";
  return "audio/mp4";
}

export type Recorder = {
  stop: () => Promise<{ blob: Blob; seconds: number; extension: string }>;
  cancel: () => void;
};

/**
 * Start recording a voice note. It stops itself after MAX_VOICE_SECONDS, so a forgotten
 * recording cannot grow into a long upload from a flooded house.
 */
export async function startRecording(): Promise<Recorder> {
  const format = voiceFormat();
  if (!format || typeof navigator === "undefined" || !navigator.mediaDevices) {
    throw new Error("this browser cannot record");
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const recorder = format.mimeType
    ? new MediaRecorder(stream, { mimeType: format.mimeType })
    : new MediaRecorder(stream);
  const chunks: Blob[] = [];
  const startedAt = Date.now();
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };
  recorder.start();
  const limit = setTimeout(() => {
    if (recorder.state === "recording") recorder.stop();
  }, MAX_VOICE_SECONDS * 1000);

  const release = () => {
    clearTimeout(limit);
    for (const track of stream.getTracks()) track.stop();
  };

  return {
    stop: () =>
      new Promise((resolve) => {
        const finish = () => {
          release();
          resolve({
            blob: new Blob(chunks, { type: voiceContentType(format.extension) }),
            seconds: Math.min(MAX_VOICE_SECONDS, Math.round((Date.now() - startedAt) / 1000)),
            extension: format.extension,
          });
        };
        if (recorder.state === "inactive") finish();
        else {
          recorder.onstop = finish;
          recorder.stop();
        }
      }),
    cancel: () => {
      if (recorder.state !== "inactive") recorder.stop();
      release();
    },
  };
}
