"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CallNow } from "@/components/CallNow";
import { AreaChooser } from "@/components/home/AreaChooser";
import { LifebuoyIcon } from "@/components/icons";
import { PinOnMap } from "@/components/sos/PinOnMap";
import { Link, useRouter } from "@/i18n/navigation";
import { normalizePhone } from "@/lib/phone";
import { useOnPhone, useStored } from "@/lib/phone-store";
import { enqueue } from "@/lib/queue";
import {
  deviceId,
  OPEN_STATUSES,
  rememberCase,
  type RememberedCase,
  type SendSos,
  type SentSos,
} from "@/lib/sos";
import { useBattery, useLocation, useQueue } from "@/lib/use-sending";
import { buttonSecondary, card, hint, input, label, notice } from "@/lib/ui";

type Place = { id: string; label: string; lat: number; lon: number };

type Props = {
  /** The project's SMS line, when there is one: the offline fallback (safety rule 1). */
  projectLine: string | null;
  /** A watched place, when the SOS is for someone else (spec 4.9). */
  place: Place | null;
};

type Phase = "ready" | "sending" | "queued" | "failed";

/**
 * The one confirmation screen between the home screen's SOS button and a sent request: two taps
 * in all (spec 4.6). Nothing here may delay the request - no sign-in, no captcha, no required
 * field but the location, which the screen starts looking for the moment it opens.
 *
 * When the request cannot go out, it is queued on the phone and retried, and this screen shows
 * the SMS fallback and the hotlines instead of an error (safety rules 1, 4 and 7).
 */
export function SendSOS({ projectLine, place }: Props) {
  const t = useTranslations("sos");
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("ready");
  const [phone, setPhone] = useState("");
  const [sitePhone, setSitePhone] = useState("");
  const [note, setNote] = useState("");
  const [locationText, setLocationText] = useState("");
  const [pin, setPin] = useState<{ lat: number; lon: number } | null>(null);
  const [showMap, setShowMap] = useState(false);
  const [showArea, setShowArea] = useState(false);
  // The cases already known when a request went into the queue: a new one appearing means the
  // queue got it through (whichever runner sent it - this screen's or the app shell's).
  const [before, setBefore] = useState<string[] | null>(null);
  // A request of this person's that is still open: offered as a link instead of a second case.
  const cases = useStored<RememberedCase[]>("sos.cases");
  // True once this screen is alive in the browser: until then a tap cannot be answered, and the
  // tests wait for it. The button stays enabled throughout, because an SOS button must never
  // look broken; the wait is a fraction of a second on the small SOS page.
  const live = useOnPhone();
  const gps = useLocation({ start: !place });
  const battery = useBattery();
  // While a request waits in the queue this screen keeps trying and watches for the answer.
  const queue = useQueue({ poll: phase === "queued" });
  const sent = useRef(false);

  const mine = useMemo(
    () => (cases ?? []).find((c) => OPEN_STATUSES.includes(c.status)) ?? null,
    [cases],
  );

  // The place's own point for an SOS on someone's behalf; otherwise GPS, a pin, or a chosen area.
  const point = useMemo(
    () => (place ? { lat: place.lat, lon: place.lon } : (gps.point ?? pin)),
    [place, gps.point, pin],
  );

  // The queue got it through: the case is now on the phone, so follow it.
  useEffect(() => {
    if (phase !== "queued" || !before) return;
    const fresh = (cases ?? []).find((c) => !before.includes(c.id));
    if (fresh) router.replace(`/sos/${fresh.id}`);
  }, [cases, before, phase, router]);

  const send = useCallback(async () => {
    if (sent.current) return;
    if (!point) {
      setShowMap(true);
      return;
    }
    sent.current = true;
    setPhase("sending");
    const body: SendSos = {
      lat: point.lat,
      lon: point.lon,
      accuracy: place ? null : gps.accuracy,
      locationText: locationText.trim() || null,
      deviceId: deviceId(),
      phone: normalizePhone(phone) ?? (phone.trim() === "" ? null : phone.trim()),
      onBehalf: !!place,
      onBehalfNote: place ? note.trim() || place.label : null,
      onSitePhone: place ? normalizePhone(sitePhone) : null,
      battery,
      sentAt: new Date().toISOString(),
    };
    try {
      const response = await fetch("/api/sos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`http ${response.status}`);
      const answer = (await response.json()) as SentSos;
      rememberCase({
        id: answer.id,
        token: answer.token,
        status: answer.status,
        createdAt: answer.createdAt,
      });
      router.replace(`/sos/${answer.id}${answer.merged ? "?merged=1" : ""}`);
      return;
    } catch {
      // Offline, or the server could not be reached: keep it and keep trying.
      const key = await enqueue("sos", "/api/sos", body as unknown as Record<string, unknown>);
      sent.current = false;
      if (key) {
        setBefore((cases ?? []).map((c) => c.id));
        setPhase("queued");
      } else {
        setPhase("failed");
      }
    }
  }, [point, place, gps.accuracy, locationText, phone, sitePhone, note, battery, cases, router]);

  const smsHref = projectLine && point
    ? `sms:${projectLine}?&body=${encodeURIComponent(
        `SOS Jaga ${point.lat.toFixed(5)},${point.lon.toFixed(5)} ${locationText.trim()}`.trim(),
      )}`
    : null;

  if (phase === "queued" || phase === "failed") {
    const failed = phase === "failed";
    return (
      <section className="flex flex-col gap-4" data-sos-state={phase}>
        <div className={notice}>
          <h1 className="text-h3 font-bold text-jaga-slate">
            {failed ? t("sent.failedTitle") : t("sent.queuedTitle")}
          </h1>
          <p className="mt-2">{failed ? t("sent.failedBody") : t("sent.queuedBody")}</p>
        </div>
        <CallNow />
        {smsHref && (
          <div className="flex flex-col gap-1">
            <a href={smsHref} className={buttonSecondary} data-sos-sms="true">
              {t("sent.smsInstead")}
            </a>
            <p className={hint}>{t("sent.smsHint")}</p>
          </div>
        )}
        <button type="button" onClick={() => void queue.run()} className={buttonSecondary}>
          {t("sent.retry")}
        </button>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-4" data-sos-state="ready" data-sos-live={live}>
      <h1 className="text-h3 font-bold text-jaga-slate">
        {place ? t("forPlace.title", { place: place.label }) : t("title")}
      </h1>
      <p>{t("intro")}</p>

      {mine && (
        <div className={notice}>
          <p>{t("status.openCase")}</p>
          <Link href={`/sos/${mine.id}`} className="min-h-tap font-medium underline">
            {t("status.openCaseLink")}
          </Link>
        </div>
      )}

      {/* The send button comes first: on a small screen it must be reachable without scrolling. */}
      <button
        type="button"
        onClick={() => void send()}
        disabled={phase === "sending"}
        data-sos-send="true"
        className="flex min-h-20 w-full items-center justify-center gap-3 rounded-2xl bg-sos px-6 py-3 text-sos-fg shadow-md active:translate-y-px disabled:opacity-70"
      >
        <LifebuoyIcon size={36} />
        <span className="text-h2 font-bold">{phase === "sending" ? t("sending") : t("send")}</span>
      </button>

      <p role="status" className={hint} data-sos-location={gps.state}>
        {place
          ? t("forPlace.locationHint")
          : gps.state === "locating"
            ? t("location.locating")
            : point
              ? t("location.found", { meters: Math.round(gps.accuracy ?? 0) })
              : t("location.failed")}
      </p>

      {!place && !point && (
        <div className="flex flex-col gap-3" data-sos-nolocation="true">
          <p className={notice}>{t("location.needed")}</p>
          <button type="button" onClick={gps.locate} className={buttonSecondary}>
            {t("location.locating")}
          </button>
          <button type="button" onClick={() => setShowMap(!showMap)} className={buttonSecondary}>
            {showMap ? t("location.hideMap") : t("location.useMap")}
          </button>
          {showMap && (
            <PinOnMap
              text={{ hint: t("location.mapHint"), failed: t("location.mapFailed") }}
              onPick={(picked) => setPin(picked)}
              picked={pin}
            />
          )}
          <button type="button" onClick={() => setShowArea(!showArea)} className={buttonSecondary}>
            {t("location.area")}
          </button>
          {showArea && (
            <AreaChooser
              onChoose={(area) => {
                setPin({ lat: area.lat, lon: area.lon });
                setShowArea(false);
              }}
              onCancel={() => setShowArea(false)}
            />
          )}
        </div>
      )}

      <div className={card}>
        <label className="flex flex-col gap-2">
          <span className={label}>{place ? t("forPlace.yourPhone") : t("phoneLabel")}</span>
          <input
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            name="phone"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            className={input}
          />
          <span className="font-medium text-jaga-slate">{t("phoneHint")}</span>
        </label>
        {place && (
          <>
            <label className="flex flex-col gap-2">
              <span className={label}>{t("forPlace.sitePhone")}</span>
              <input
                type="tel"
                inputMode="tel"
                value={sitePhone}
                onChange={(event) => setSitePhone(event.target.value)}
                className={input}
              />
            </label>
            <label className="flex flex-col gap-2">
              <span className={label}>{t("forPlace.note")}</span>
              <input
                type="text"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={200}
                className={input}
              />
            </label>
          </>
        )}
        <label className="flex flex-col gap-2">
          <span className={label}>{t("location.textLabel")}</span>
          <input
            type="text"
            value={locationText}
            onChange={(event) => setLocationText(event.target.value)}
            maxLength={300}
            className={input}
          />
          <span className={hint}>{t("location.textHint")}</span>
        </label>
      </div>

      <CallNow />
    </section>
  );
}
