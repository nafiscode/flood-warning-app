"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { MAX_PHOTOS, MAX_VOICE_SECONDS, type Recorder, startRecording } from "@/lib/media";
import { buttonSecondary, hint, label } from "@/lib/ui";

export type VoiceNote = { blob: Blob; extension: string; seconds: number };

type Props = {
  photos: Blob[];
  onPhotos: (photos: Blob[]) => void;
  voice: VoiceNote | null;
  onVoice: (voice: VoiceNote | null) => void;
};

/**
 * Up to three photos and one voice note, for a flood report and for SOS details (spec 4.5, 4.6).
 * Pictures are shrunk on the phone when they are uploaded (lib/media.ts), and recording stops
 * itself at 60 s. The browser's own camera and file picker are used, so nothing has to be
 * downloaded for this.
 */
export function MediaFields({ photos, onPhotos, voice, onVoice }: Props) {
  const t = useTranslations("report");
  const [recorder, setRecorder] = useState<Recorder | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [failed, setFailed] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  // Count the seconds while recording, so the person sees the 60 s limit coming.
  useEffect(() => {
    if (!recorder) return;
    const timer = window.setInterval(() => setSeconds((n) => n + 1), 1000);
    return () => window.clearInterval(timer);
  }, [recorder]);

  // Stop the microphone if the person leaves the page mid-recording.
  useEffect(() => () => recorder?.cancel(), [recorder]);

  async function record() {
    setFailed(false);
    try {
      setSeconds(0);
      setRecorder(await startRecording());
    } catch {
      setFailed(true);
    }
  }

  async function stop() {
    const current = recorder;
    setRecorder(null);
    if (!current) return;
    const finished = await current.stop();
    onVoice({ blob: finished.blob, extension: finished.extension, seconds: finished.seconds });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <span className={label}>{t("photos")}</span>
        <p className={hint}>{t("photosHint")}</p>
        <input
          ref={file}
          type="file"
          accept="image/*"
          multiple
          className="sr-only"
          onChange={(event) => {
            const chosen = Array.from(event.target.files ?? []);
            onPhotos([...photos, ...chosen].slice(0, MAX_PHOTOS));
            event.target.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => file.current?.click()}
          disabled={photos.length >= MAX_PHOTOS}
          className={buttonSecondary}
        >
          {t("addPhoto")}
        </button>
        {photos.length > 0 && (
          <ul className="flex flex-col gap-2">
            {photos.map((photo, index) => (
              <li key={index} className="flex items-center justify-between gap-3">
                <span>{`${index + 1} · ${Math.round(photo.size / 1024)} KB`}</span>
                <button
                  type="button"
                  onClick={() => onPhotos(photos.filter((_, i) => i !== index))}
                  className="min-h-tap underline"
                >
                  {t("removePhoto")}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <span className={label}>{t("voice")}</span>
        {recorder ? (
          <>
            <button type="button" onClick={() => void stop()} className={buttonSecondary}>
              {t("stopRecording")}
            </button>
            <p role="status" className={hint}>
              {t("recording", { seconds: Math.min(seconds, MAX_VOICE_SECONDS) })}
            </p>
          </>
        ) : (
          <button type="button" onClick={() => void record()} className={buttonSecondary}>
            {t("record")}
          </button>
        )}
        {voice && !recorder && (
          <div className="flex items-center justify-between gap-3">
            <span>{t("recorded", { seconds: voice.seconds })}</span>
            <button type="button" onClick={() => onVoice(null)} className="min-h-tap underline">
              {t("removeVoice")}
            </button>
          </div>
        )}
        {failed && <p className={hint}>{t("recordFailed")}</p>}
      </div>
    </div>
  );
}
