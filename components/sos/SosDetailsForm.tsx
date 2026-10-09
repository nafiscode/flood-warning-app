"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { MediaFields } from "@/components/report/MediaFields";
import { enqueue } from "@/lib/queue";
import { DEPTHS, HAZARD_CHOICES, type SosDetails, VULNERABLE, type Vulnerable } from "@/lib/sos";
import { SOS_BUCKET, uploadMedia } from "@/lib/upload";
import { buttonPrimary, card, checkBox, checkRow, hint, input, label, notice } from "@/lib/ui";

type Props = { id: string; token: string | null };

/**
 * The details asked only after the request has been sent (spec 4.6): what is happening, how many
 * people, who needs special help, how deep the water is, injuries, pictures and a voice note.
 * Nothing is required and nothing is pre-selected - "what's happening" starts unset and the case
 * keeps "not sure" until the person says otherwise.
 */
export function SosDetailsForm({ id, token }: Props) {
  const t = useTranslations("sos");
  // The depth labels ("knee", "waist"...) live with the report form's text: one wording for both.
  const tDepth = useTranslations("report");
  const [hazard, setHazard] = useState("");
  const [people, setPeople] = useState("");
  const [vulnerable, setVulnerable] = useState<Vulnerable[]>([]);
  const [depth, setDepth] = useState("");
  const [injuries, setInjuries] = useState("");
  const [text, setText] = useState("");
  const [photos, setPhotos] = useState<Blob[]>([]);
  const [voice, setVoice] = useState<{ blob: Blob; extension: string; seconds: number } | null>(
    null,
  );
  const [state, setState] = useState<"ready" | "saving" | "saved" | "failed">("ready");
  const [mediaFailed, setMediaFailed] = useState(0);

  const headers = {
    "Content-Type": "application/json",
    ...(token ? { "x-jaga-sos-token": token } : {}),
  };

  async function save() {
    setState("saving");
    setMediaFailed(0);
    const details: SosDetails & { action: "details"; token: string | null } = {
      action: "details",
      token,
      hazardType: hazard === "" ? null : (hazard as SosDetails["hazardType"]),
      peopleCount: people === "" ? null : Number(people),
      vulnerable,
      depth: depth === "" ? null : (depth as SosDetails["depth"]),
      injuries: injuries.trim() || null,
      text: text.trim() || null,
    };
    try {
      const response = await fetch(`/api/sos/${id}`, {
        method: "POST",
        headers,
        body: JSON.stringify(details),
        cache: "no-store",
      });
      if (!response.ok) throw new Error(String(response.status));
      setState("saved");
    } catch {
      // Keep it: details are worth sending late, and the queue preserves the order.
      await enqueue("sos-details", `/api/sos/${id}`, details as unknown as Record<string, unknown>);
      setState("saved");
      return;
    }

    if (photos.length === 0 && !voice) return;
    const uploaded = await uploadMedia(SOS_BUCKET, id, photos, voice);
    setMediaFailed(uploaded.failed);
    if (uploaded.photos.length === 0 && !uploaded.voice) return;
    const media = {
      action: "media" as const,
      token,
      photos: uploaded.photos,
      voice: uploaded.voice,
    };
    try {
      const response = await fetch(`/api/sos/${id}`, {
        method: "POST",
        headers,
        body: JSON.stringify(media),
        cache: "no-store",
      });
      if (!response.ok) throw new Error(String(response.status));
    } catch {
      await enqueue("sos-details", `/api/sos/${id}`, media as unknown as Record<string, unknown>);
    }
  }

  return (
    <div className={card} data-sos-details={state}>
      <h2 className="text-h3 font-bold text-jaga-ink">{t("details.title")}</h2>
      <p>{t("details.intro")}</p>

      <label className="flex flex-col gap-2">
        <span className={label}>{t("details.hazard")}</span>
        <select
          value={hazard}
          onChange={(event) => setHazard(event.target.value)}
          className={input}
          data-sos-hazard="true"
        >
          {/* Never pre-selected (spec 4.6): the case stays "not sure" until the person picks. */}
          <option value="">{t("details.hazardUnset")}</option>
          {HAZARD_CHOICES.filter((h) => h !== "unknown").map((choice) => (
            <option key={choice} value={choice}>
              {t(`hazards.${choice}`)}
            </option>
          ))}
          <option value="unknown">{t("hazards.unknown")}</option>
        </select>
      </label>

      <label className="flex flex-col gap-2">
        <span className={label}>{t("details.people")}</span>
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={500}
          value={people}
          onChange={(event) => setPeople(event.target.value)}
          className={input}
        />
      </label>

      <fieldset className="flex flex-col">
        <legend className={label}>{t("details.vulnerable")}</legend>
        {VULNERABLE.map((kind) => (
          <label key={kind} className={checkRow}>
            <input
              type="checkbox"
              className={checkBox}
              checked={vulnerable.includes(kind)}
              onChange={(event) =>
                setVulnerable((current) =>
                  event.target.checked ? [...current, kind] : current.filter((v) => v !== kind),
                )
              }
            />
            <span>{t(`vulnerable.${kind}`)}</span>
          </label>
        ))}
      </fieldset>

      <label className="flex flex-col gap-2">
        <span className={label}>{t("details.depth")}</span>
        <select value={depth} onChange={(event) => setDepth(event.target.value)} className={input}>
          <option value="">{t("details.hazardUnset")}</option>
          {DEPTHS.map((choice) => (
            <option key={choice} value={choice}>
              {tDepth(`depths.${choice}`)}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-2">
        <span className={label}>{t("details.injuries")}</span>
        <input
          type="text"
          value={injuries}
          onChange={(event) => setInjuries(event.target.value)}
          maxLength={500}
          className={input}
        />
      </label>

      <label className="flex flex-col gap-2">
        <span className={label}>{t("details.text")}</span>
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          maxLength={1000}
          rows={3}
          className={input}
        />
      </label>

      <MediaFields photos={photos} onPhotos={setPhotos} voice={voice} onVoice={setVoice} />

      <button
        type="button"
        onClick={() => void save()}
        disabled={state === "saving"}
        className={buttonPrimary}
      >
        {state === "saving" ? t("details.saving") : t("details.save")}
      </button>
      {state === "saved" && <p className={hint}>{t("details.saved")}</p>}
      {state === "failed" && <p className={notice}>{t("details.saveFailed")}</p>}
      {mediaFailed > 0 && (
        <p className={notice}>{t("details.mediaFailed", { count: mediaFailed })}</p>
      )}
    </div>
  );
}
