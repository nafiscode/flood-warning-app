"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { MediaFields, type VoiceNote } from "@/components/report/MediaFields";
import { PinOnMap } from "@/components/sos/PinOnMap";
import { Link } from "@/i18n/navigation";
import { enqueue } from "@/lib/queue";
import { DEPTHS, ROAD_ACCESS, TRENDS } from "@/lib/sos";
import { REPORT_BUCKET, uploadMedia } from "@/lib/upload";
import { useLocation, useQueue } from "@/lib/use-sending";
import {
  buttonPrimary,
  buttonSecondary,
  card,
  errorNotice,
  hint,
  input,
  label,
  notice,
} from "@/lib/ui";

type State = "ready" | "sending" | "sent" | "queued" | "rate" | "failed";

/**
 * The flood report (spec 4.5): where, how deep against a person's body, which way the water is
 * going, whether the road is passable, and optional pictures, voice note and text.
 *
 * It is not an emergency channel - the screen says so and keeps SOS and 1669 in reach. Offline it
 * joins the same queue as an SOS, behind it, so a report never delays a request for help.
 */
export function ReportForm() {
  const t = useTranslations("report");
  const [depth, setDepth] = useState("");
  const [trend, setTrend] = useState("");
  const [road, setRoad] = useState("");
  const [text, setText] = useState("");
  const [pin, setPin] = useState<{ lat: number; lon: number } | null>(null);
  const [showMap, setShowMap] = useState(false);
  const [photos, setPhotos] = useState<Blob[]>([]);
  const [voice, setVoice] = useState<VoiceNote | null>(null);
  const [state, setState] = useState<State>("ready");
  const [mediaFailed, setMediaFailed] = useState(0);
  const gps = useLocation({ start: false });
  useQueue();

  const point = pin ?? gps.point;

  async function send() {
    if (!point) {
      setShowMap(true);
      return;
    }
    setState("sending");
    setMediaFailed(0);
    const body = {
      lat: point.lat,
      lon: point.lon,
      depth: depth || null,
      trend: trend || null,
      roadAccess: road || null,
      text: text.trim() || null,
    };
    let id: string | null = null;
    try {
      const response = await fetch("/api/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
      });
      if (response.status === 429) {
        setState("rate");
        return;
      }
      if (!response.ok) throw new Error(String(response.status));
      id = ((await response.json()) as { id: string }).id;
    } catch {
      const key = await enqueue("report", "/api/report", body);
      setState(key ? "queued" : "failed");
      return;
    }

    if (id && (photos.length > 0 || voice)) {
      const uploaded = await uploadMedia(REPORT_BUCKET, id, photos, voice);
      setMediaFailed(uploaded.failed);
      if (uploaded.photos.length > 0 || uploaded.voice) {
        // Tell the report where its media is; a failure here only loses the pictures.
        await fetch(`/api/report/${id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ photos: uploaded.photos, voice: uploaded.voice }),
          cache: "no-store",
        }).catch(() =>
          setMediaFailed((n) => n + uploaded.photos.length + (uploaded.voice ? 1 : 0)),
        );
      }
    }
    setState("sent");
  }

  if (state === "sent" || state === "queued") {
    const queued = state === "queued";
    return (
      <section className="flex flex-col gap-4" data-report-state={state}>
        <div className={notice}>
          <h1 className="text-h3 font-bold text-jaga-ink">
            {queued ? t("queuedTitle") : t("sentTitle")}
          </h1>
          <p className="mt-2">{queued ? t("queuedBody") : t("sentBody")}</p>
        </div>
        {mediaFailed > 0 && (
          <p className={errorNotice}>{t("mediaFailed", { count: mediaFailed })}</p>
        )}
        <button
          type="button"
          onClick={() => {
            setState("ready");
            setPhotos([]);
            setVoice(null);
            setText("");
          }}
          className={buttonSecondary}
        >
          {t("another")}
        </button>
        <Link href="/" className={buttonPrimary}>
          {t("home")}
        </Link>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-4" data-report-state={state}>
      <h1 className="text-h3 font-bold text-jaga-ink">{t("title")}</h1>
      <p>{t("intro")}</p>
      <p className={notice}>
        {t("notEmergency")}{" "}
        <Link href="/sos" className="font-medium underline">
          SOS
        </Link>
      </p>

      <div className={card}>
        <span className={label}>{t("location")}</span>
        <p className={hint}>{t("locationHint")}</p>
        <button type="button" onClick={gps.locate} className={buttonSecondary}>
          {gps.state === "locating" ? t("locating") : t("useGps")}
        </button>
        <button type="button" onClick={() => setShowMap(!showMap)} className={buttonSecondary}>
          {showMap ? t("hideMap") : t("useMap")}
        </button>
        {showMap && (
          <PinOnMap
            text={{ hint: t("mapHint"), failed: t("mapFailed") }}
            picked={pin}
            onPick={setPin}
          />
        )}
        <p role="status" className={hint} data-report-location={point ? "ok" : gps.state}>
          {point
            ? `${point.lat.toFixed(5)}, ${point.lon.toFixed(5)}`
            : gps.state === "failed"
              ? t("needLocation")
              : ""}
        </p>
      </div>

      <div className={card}>
        <label className="flex flex-col gap-2">
          <span className={label}>{t("depth")}</span>
          <span className={hint}>{t("depthHint")}</span>
          <select
            value={depth}
            onChange={(event) => setDepth(event.target.value)}
            className={input}
            data-report-depth="true"
          >
            <option value="">—</option>
            {DEPTHS.map((choice) => (
              <option key={choice} value={choice}>
                {t(`depths.${choice}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-2">
          <span className={label}>{t("trend")}</span>
          <select
            value={trend}
            onChange={(event) => setTrend(event.target.value)}
            className={input}
          >
            <option value="">—</option>
            {TRENDS.map((choice) => (
              <option key={choice} value={choice}>
                {t(`trends.${choice}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-2">
          <span className={label}>{t("roadAccess")}</span>
          <select value={road} onChange={(event) => setRoad(event.target.value)} className={input}>
            <option value="">—</option>
            {ROAD_ACCESS.map((choice) => (
              <option key={choice} value={choice}>
                {t(`roads.${choice}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-2">
          <span className={label}>{t("text")}</span>
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={3}
            maxLength={1000}
            className={input}
          />
        </label>
        <MediaFields photos={photos} onPhotos={setPhotos} voice={voice} onVoice={setVoice} />
      </div>

      {state === "rate" && <p className={errorNotice}>{t("rateLimited")}</p>}
      {state === "failed" && <p className={errorNotice}>{t("failed")}</p>}
      <button
        type="button"
        onClick={() => void send()}
        disabled={state === "sending"}
        data-report-send="true"
        className={buttonPrimary}
      >
        {state === "sending" ? t("sending") : t("send")}
      </button>
    </section>
  );
}
