/* eslint-disable @next/next/no-img-element -- short-lived signed links to a private bucket; next/image cannot fetch them */
"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import type { CaseMedia } from "@/lib/dispatch";
import { MAX_PHOTOS } from "@/lib/media";
import { buttonPrimary, buttonSecondary, hint, input } from "@/lib/ui";

/**
 * Finishing a case (spec 5.4): the form a team reports a rescue with, the same form a second
 * team confirms one with, and the case's own photos once somebody asks to see them.
 *
 * A report needs a photo and nothing else: the note is there for the team that wants one, never
 * required of a crew with wet hands. A fallback confirmation needs both, because it stands in
 * for the word of the person who was rescued.
 */

type FormProps = {
  /** "complete": the team's own report. "confirm": the fallback by a second team. */
  kind: "complete" | "confirm";
  busy: boolean;
  onSend: (photos: File[], note: string) => void;
  onCancel: () => void;
};

export function PhotoForm({ kind, busy, onSend, onCancel }: FormProps) {
  const t = useTranslations("authority");
  const [photos, setPhotos] = useState<File[]>([]);
  const [note, setNote] = useState("");
  const needsNote = kind === "confirm";
  const ready = photos.length > 0 && (!needsNote || note.trim() !== "");

  return (
    <fieldset
      className="flex flex-col gap-3 rounded-xl border-2 border-jaga-teal-ink p-3"
      data-finish-form={kind}
    >
      <legend className="px-1 font-bold text-jaga-ink">{t(`finish.${kind}.title`)}</legend>
      <p className={hint}>{t(`finish.${kind}.hint`)}</p>

      <label className={`${buttonSecondary} cursor-pointer`}>
        {photos.length > 0
          ? t("finish.photosChosen", { count: photos.length })
          : t("finish.choosePhoto")}
        <input
          type="file"
          accept="image/*"
          multiple
          className="sr-only"
          data-finish-photos="true"
          onChange={(e) => setPhotos(Array.from(e.target.files ?? []).slice(0, MAX_PHOTOS))}
        />
      </label>
      <p className={hint}>{t("finish.photoHint", { max: MAX_PHOTOS })}</p>

      <label className="flex flex-col gap-1">
        <span className="font-medium">
          {needsNote ? t("finish.noteRequired") : t("finish.noteOptional")}
        </span>
        <textarea
          className={`${input} min-h-24`}
          maxLength={1000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          data-finish-note="true"
        />
      </label>

      <button
        type="button"
        disabled={busy || !ready}
        onClick={() => onSend(photos, note)}
        data-finish-send="true"
        className={buttonPrimary}
      >
        {busy ? t("finish.sending") : t(`finish.${kind}.send`)}
      </button>
      {!ready && <p className={hint}>{needsNote ? t("finish.needBoth") : t("finish.needPhoto")}</p>}
      <button
        type="button"
        disabled={busy}
        onClick={onCancel}
        className="inline-flex min-h-tap items-center self-start font-medium underline"
      >
        {t("finish.cancel")}
      </button>
    </fieldset>
  );
}

/** A case's photos, voice note and evidence, behind links that stop working in ten minutes. */
export function MediaView({ media }: { media: CaseMedia | "failed" }) {
  const t = useTranslations("authority");
  if (media === "failed") {
    return <p className="font-medium">{t("media.failed")}</p>;
  }
  const nothing = media.photos.length === 0 && !media.voice && media.proof.length === 0;
  const strip = (links: string[], alt: string) => (
    <div className="flex flex-wrap gap-2">
      {links.map((src, index) => (
        <a key={src} href={src} target="_blank" rel="noreferrer" className="block">
          <img
            src={src}
            alt={`${alt} ${index + 1}`}
            loading="lazy"
            className="size-24 rounded-lg border border-jaga-line object-cover"
          />
        </a>
      ))}
    </div>
  );
  return (
    <div className="flex flex-col gap-3 border-t border-jaga-line pt-3" data-media="shown">
      {nothing && <p className={hint}>{t("media.none")}</p>}
      {media.photos.length > 0 && (
        <>
          <p className="font-medium">{t("media.fromSender")}</p>
          {strip(media.photos, t("media.fromSender"))}
        </>
      )}
      {media.voice && (
        <>
          <p className="font-medium">{t("media.voice")}</p>
          <audio controls preload="none" src={media.voice} className="w-full" />
        </>
      )}
      {media.proof.length > 0 && (
        <>
          <p className="font-medium">{t("media.proof")}</p>
          {strip(media.proof, t("media.proof"))}
        </>
      )}
    </div>
  );
}
