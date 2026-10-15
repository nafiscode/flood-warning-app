"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CallNow } from "@/components/CallNow";
import { AreaChooser } from "@/components/home/AreaChooser";
import {
  LifebuoyIcon,
  ListIcon,
  LocateIcon,
  MapIcon,
  ParcelIcon,
  RetryIcon,
} from "@/components/icons";
import { PinOnMap } from "@/components/sos/PinOnMap";
import { Link, useRouter } from "@/i18n/navigation";
import { normalizePhone } from "@/lib/phone";
import { useOnPhone, useStored } from "@/lib/phone-store";
import { enqueue } from "@/lib/queue";
import {
  deviceId,
  openCase,
  NEEDS,
  OPEN_STATUSES,
  rememberCase,
  SUPPLIES_LEFT,
  type Need,
  type RememberedCase,
  type SendSos,
  type SentSos,
  type SuppliesLeft,
} from "@/lib/sos";
import { useBattery, useLocation, useQueue } from "@/lib/use-sending";
import {
  buttonPrimary,
  buttonSecondary,
  card,
  checkBox,
  checkRow,
  hint,
  input,
  label,
  notice,
} from "@/lib/ui";

type Phase = "ready" | "sending" | "queued" | "failed";

/**
 * A request for food, drinking water and essentials (spec 4.10), from someone who is safe where
 * they are and cut off by the water.
 *
 * It travels the same road as an SOS - the same endpoint, the same offline queue, the same case
 * page afterwards - so it is never refused and needs no account. What differs is the form: what
 * is needed is the whole point of the request, so it is asked before sending, and nothing but the
 * location is required. The way to a real SOS is at the top of the screen, never further than one
 * tap, for anyone who opened this page while in danger.
 */
export function SendSupplies() {
  const t = useTranslations("sos");
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("ready");
  const [needs, setNeeds] = useState<Need[]>(["water", "food"]);
  const [left, setLeft] = useState<SuppliesLeft | null>(null);
  const [people, setPeople] = useState("");
  const [needsNote, setNeedsNote] = useState("");
  const [phone, setPhone] = useState("");
  const [locationText, setLocationText] = useState("");
  const [pin, setPin] = useState<{ lat: number; lon: number } | null>(null);
  const [showMap, setShowMap] = useState(false);
  const [showArea, setShowArea] = useState(false);
  const [before, setBefore] = useState<string[] | null>(null);
  const cases = useStored<RememberedCase[]>("sos.cases");
  const live = useOnPhone();
  const gps = useLocation();
  const battery = useBattery();
  const queue = useQueue({ poll: phase === "queued" });
  const sent = useRef(false);

  const mine = useMemo(
    () => (cases ?? []).find((c) => OPEN_STATUSES.includes(c.status)) ?? null,
    [cases],
  );
  const point = useMemo(() => gps.point ?? pin, [gps.point, pin]);

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
    const count = Number(people);
    const body: SendSos = {
      lat: point.lat,
      lon: point.lon,
      accuracy: gps.accuracy,
      locationText: locationText.trim() || null,
      deviceId: deviceId(),
      // This phone's own open case, if any: a repeat then updates it (submit_sos).
      caseToken: openCase()?.token ?? null,
      phone: normalizePhone(phone) ?? (phone.trim() === "" ? null : phone.trim()),
      battery,
      sentAt: new Date().toISOString(),
      kind: "supplies",
      needs,
      needsNote: needsNote.trim() || null,
      suppliesLeft: left,
      peopleCount: Number.isFinite(count) && count >= 1 ? Math.round(count) : null,
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
      // Offline, or the server could not be reached: keep it and keep trying, like an SOS.
      const key = await enqueue("sos", "/api/sos", body as unknown as Record<string, unknown>);
      sent.current = false;
      if (key) {
        setBefore((cases ?? []).map((c) => c.id));
        setPhase("queued");
      } else {
        setPhase("failed");
      }
    }
  }, [
    point,
    gps.accuracy,
    locationText,
    phone,
    battery,
    needs,
    needsNote,
    left,
    people,
    cases,
    router,
  ]);

  const toSos = (
    <div className={notice} data-supplies-not-rescue="true">
      <p className="font-bold text-jaga-ink">{t("supplies.notRescue")}</p>
      <Link
        href="/sos"
        className="mt-2 flex min-h-tap w-full items-center justify-center gap-2 rounded-xl bg-sos px-4 py-2 font-bold text-sos-fg"
      >
        <LifebuoyIcon size={24} />
        {t("supplies.sosInstead")}
      </Link>
    </div>
  );

  if (phase === "queued" || phase === "failed") {
    const failed = phase === "failed";
    return (
      <section className="flex flex-col gap-4" data-supplies-state={phase}>
        <div className={notice}>
          <h1 className="text-h3 font-bold text-jaga-ink">
            {failed ? t("sent.failedTitle") : t("sent.queuedTitle")}
          </h1>
          <p className="mt-2">{failed ? t("sent.failedBody") : t("sent.queuedBody")}</p>
        </div>
        {toSos}
        <CallNow />
        <button type="button" onClick={() => void queue.run()} className={buttonSecondary}>
          <RetryIcon size={22} />
          {t("sent.retry")}
        </button>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-4" data-supplies-state="ready" data-supplies-live={live}>
      <h1 className="flex items-center gap-2 text-h3 font-bold text-jaga-ink">
        <ParcelIcon size={28} />
        {t("supplies.title")}
      </h1>
      <p>{t("supplies.intro")}</p>
      {toSos}

      {mine && (
        <div className={notice}>
          <p>{t("status.openCase")}</p>
          <Link href={`/sos/${mine.id}`} className="min-h-tap font-medium underline">
            {t("status.openCaseLink")}
          </Link>
        </div>
      )}

      <fieldset className={card}>
        <legend className={`${label} float-start`}>{t("supplies.needsLabel")}</legend>
        <p className={`${hint} clear-both`}>{t("supplies.needsHint")}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2">
          {NEEDS.map((need) => (
            <label key={need} className={checkRow}>
              <input
                type="checkbox"
                className={checkBox}
                checked={needs.includes(need)}
                data-need={need}
                onChange={(event) =>
                  setNeeds((now) =>
                    event.target.checked ? [...now, need] : now.filter((n) => n !== need),
                  )
                }
              />
              <span>{t(`needs.${need}`)}</span>
            </label>
          ))}
        </div>
        {needs.includes("medicine") && (
          <p className="font-bold text-jaga-ink" data-medicine-hint="true">
            {t("supplies.medicineHint")}
          </p>
        )}
      </fieldset>

      <div className={card}>
        <fieldset className="flex flex-col gap-1">
          <legend className={label}>{t("supplies.leftLabel")}</legend>
          {SUPPLIES_LEFT.map((choice) => (
            <label key={choice} className={checkRow}>
              <input
                type="radio"
                name="supplies-left"
                className={checkBox}
                checked={left === choice}
                data-left={choice}
                onChange={() => setLeft(choice)}
              />
              <span>{t(`supplies.left.${choice}`)}</span>
            </label>
          ))}
        </fieldset>
        <label className="flex flex-col gap-2">
          <span className={label}>{t("supplies.peopleLabel")}</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={500}
            value={people}
            onChange={(event) => setPeople(event.target.value)}
            data-supplies-people="true"
            className="min-h-tap w-24 rounded-xl border border-jaga-line bg-jaga-surface px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-2">
          <span className={label}>{t("supplies.noteLabel")}</span>
          <textarea
            value={needsNote}
            onChange={(event) => setNeedsNote(event.target.value)}
            maxLength={500}
            data-supplies-note="true"
            className={`${input} min-h-24`}
          />
          <span className={hint}>{t("supplies.noteHint")}</span>
        </label>
      </div>

      <div className={card}>
        <label className="flex flex-col gap-2">
          <span className={label}>{t("phoneLabel")}</span>
          <input
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            name="phone"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            className={input}
          />
          <span className="font-medium text-jaga-ink">{t("phoneHint")}</span>
        </label>
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

      <p role="status" className={hint} data-supplies-location={gps.state}>
        {gps.state === "locating"
          ? t("location.locating")
          : point
            ? t("location.found", { meters: Math.round(gps.accuracy ?? 0) })
            : t("location.failed")}
      </p>

      {!point && (
        <div className="flex flex-col gap-3" data-supplies-nolocation="true">
          <p className={notice}>{t("location.needed")}</p>
          <button
            type="button"
            onClick={gps.locate}
            disabled={gps.state === "locating"}
            className={buttonSecondary}
          >
            <LocateIcon size={22} />
            {/* Idle, it is a button to try GPS again; it says "finding" only while it is (A9). */}
            {gps.state === "locating" ? t("location.locating") : t("location.tryAgain")}
          </button>
          <button type="button" onClick={() => setShowMap(!showMap)} className={buttonSecondary}>
            <MapIcon size={22} />
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
            <ListIcon size={22} />
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

      <button
        type="button"
        onClick={() => void send()}
        disabled={phase === "sending"}
        data-supplies-send="true"
        className={`${buttonPrimary} min-h-16 gap-3 text-h3 font-bold`}
      >
        <ParcelIcon size={28} />
        {phase === "sending" ? t("supplies.sending") : t("supplies.send")}
      </button>
      <p className={hint}>{t("supplies.scope")}</p>

      <CallNow />
    </section>
  );
}
