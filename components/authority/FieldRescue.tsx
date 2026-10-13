"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { Journey } from "@/components/journey/Journey";
import { pickName } from "@/lib/area";
import { flushFields, keepField, sendField, waitingFields } from "@/lib/field-queue";
import {
  checkFieldForm,
  FIELD_URL,
  fieldJourney,
  type FieldFormError,
  type FieldResult,
  type MyFieldRescue,
} from "@/lib/field-rescue";
import { MAX_PHOTOS } from "@/lib/media";
import { VULNERABLE, type Vulnerable } from "@/lib/sos";
import {
  buttonPrimary,
  buttonSecondary,
  card,
  checkBox,
  checkRow,
  errorNotice,
  hint,
  input,
  label,
  notice,
} from "@/lib/ui";
import { useLocation } from "@/lib/use-sending";

export type FieldRescueViewProps = {
  /** The phone's position right now, or null while it is still being found. */
  located: { accuracy: number | null } | null;
  locating: boolean;
  onLocate: () => void;
  busy: boolean;
  error: FieldFormError | "upload" | "stale" | "outside" | "not_team" | "failed" | null;
  result: FieldResult | null;
  rescues: MyFieldRescue[];
  /** Records kept on this phone because there was no signal. */
  waiting?: number;
  /** The record just made was kept on the phone rather than sent. */
  saved?: boolean;
  onFlush?: () => void;
  onSend: (form: {
    people: number;
    vulnerable: Vulnerable[];
    phone: string;
    note: string;
    photos: File[];
  }) => void;
  onAnother: () => void;
};

/**
 * "Record a rescue we did" (the owner, 13-14 Oct): for people a team found and helped who never
 * sent an SOS. The owner's rules are on the screen as they are in the database: it must be
 * recorded at the place and at the moment (the phone's own position, no pin on a map), with a
 * phone number for the rescued person and a photo; it is worth half an SOS rescue; and it counts
 * at once only where a flood is known or expected, otherwise an admin checks it first.
 *
 * Drawn from what it is given, so it is tested without a phone; `FieldRescue` below does the
 * locating, the upload and the asking.
 */
export function FieldRescueView(props: FieldRescueViewProps) {
  const t = useTranslations("fieldRescue");
  const tSos = useTranslations("sos");
  const locale = useLocale();
  const [people, setPeople] = useState("1");
  const [vulnerable, setVulnerable] = useState<Vulnerable[]>([]);
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [missing, setMissing] = useState<FieldFormError | null>(null);
  const { result } = props;

  const send = () => {
    const count = Number.parseInt(people, 10);
    const problem = checkFieldForm({
      located: props.located !== null,
      phone,
      people: count,
      photos: photos.length,
    });
    setMissing(problem);
    if (!problem) props.onSend({ people: count, vulnerable, phone, note, photos });
  };
  const shown = missing ?? props.error;

  return (
    <div className="flex flex-col gap-5" data-field-rescue={result?.status ?? "form"}>
      <h1 className="text-h3 font-bold text-jaga-ink">{t("title")}</h1>
      <p>{t("intro")}</p>
      <ul className={`${notice} flex list-disc flex-col gap-1 ps-8`}>
        <li>{t("rules.now")}</li>
        <li>{t("rules.proof")}</li>
        <li>{t("rules.half")}</li>
        <li>{t("rules.review")}</li>
      </ul>

      {(props.waiting ?? 0) > 0 && (
        <section className={notice} data-field-waiting={props.waiting}>
          <p className="font-bold">{t("later.waiting", { count: props.waiting ?? 0 })}</p>
          <p className={hint}>{t("later.waitingHint")}</p>
          {props.onFlush && (
            <button type="button" className={`${buttonSecondary} mt-2`} onClick={props.onFlush}>
              {t("later.sendNow")}
            </button>
          )}
        </section>
      )}

      {props.saved ? (
        <section className={card} role="status" data-field-result="saved">
          <h2 className="text-body font-bold text-jaga-ink">{t("later.saved")}</h2>
          <p>{t("later.savedBody")}</p>
          <button type="button" className={buttonSecondary} onClick={props.onAnother}>
            {t("another")}
          </button>
        </section>
      ) : result ? (
        <section className={card} role="status" data-field-result={result.status}>
          <h2 className="text-body font-bold text-jaga-ink">
            {result.status === "counted" ? t("result.counted") : t("result.pending")}
          </h2>
          {result.status === "counted" ? (
            <p>{t("result.points", { points: result.points })}</p>
          ) : (
            <>
              <p>{t("result.pendingBody")}</p>
              <ul className="flex list-disc flex-col gap-1 ps-6">
                {result.holds.map((hold) => (
                  <li key={hold} data-hold={hold}>
                    {t(`holds.${hold}`)}
                  </li>
                ))}
              </ul>
            </>
          )}
          <button type="button" className={buttonSecondary} onClick={props.onAnother}>
            {t("another")}
          </button>
        </section>
      ) : (
        <section className={card}>
          <div
            className="flex flex-col gap-2"
            data-field-position={props.located ? "found" : "none"}
          >
            <p className={label}>{t("position.label")}</p>
            {props.located ? (
              <p className="font-bold text-jaga-ink">
                {props.located.accuracy !== null
                  ? t("position.found", { m: Math.round(props.located.accuracy) })
                  : t("position.foundNoAccuracy")}
              </p>
            ) : (
              <p>{props.locating ? t("position.locating") : t("position.failed")}</p>
            )}
            <button type="button" className={buttonSecondary} onClick={props.onLocate}>
              {t("position.again")}
            </button>
            <p className={hint}>{t("position.hint")}</p>
          </div>

          <label htmlFor="field-people" className={label}>
            {t("people")}
          </label>
          <input
            id="field-people"
            inputMode="numeric"
            value={people}
            onChange={(e) => setPeople(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))}
            className={`${input} max-w-32`}
          />

          <fieldset className="flex flex-col">
            <legend className={label}>{t("vulnerable")}</legend>
            {VULNERABLE.map((v) => (
              <label key={v} className={checkRow}>
                <input
                  type="checkbox"
                  className={checkBox}
                  checked={vulnerable.includes(v)}
                  onChange={(e) =>
                    setVulnerable((now) =>
                      e.target.checked ? [...now, v] : now.filter((x) => x !== v),
                    )
                  }
                />
                <span>{tSos(`vulnerable.${v}`)}</span>
              </label>
            ))}
          </fieldset>

          <label htmlFor="field-phone" className={label}>
            {t("phone.label")}
          </label>
          <input
            id="field-phone"
            type="tel"
            inputMode="tel"
            autoComplete="off"
            placeholder="08x-xxx-xxxx"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className={input}
          />
          <p className={hint}>{t("phone.hint")}</p>

          <label className={`${buttonSecondary} cursor-pointer`}>
            {photos.length > 0 ? t("photo.chosen", { count: photos.length }) : t("photo.choose")}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              className="sr-only"
              data-field-photos="true"
              onChange={(e) => setPhotos(Array.from(e.target.files ?? []).slice(0, MAX_PHOTOS))}
            />
          </label>
          <p className={hint}>{t("photo.hint")}</p>

          <label htmlFor="field-note" className={label}>
            {t("note")}
          </label>
          <input
            id="field-note"
            value={note}
            maxLength={500}
            onChange={(e) => setNote(e.target.value)}
            className={input}
          />

          {shown && (
            <p role="alert" className={errorNotice} data-field-error={shown}>
              {t(`error.${shown}`)}
            </p>
          )}
          <button
            type="button"
            className={buttonPrimary}
            disabled={props.busy}
            onClick={send}
            data-field-send="true"
          >
            {props.busy ? t("sending") : t("send")}
          </button>
        </section>
      )}

      <section className="flex flex-col gap-4" data-field-list={props.rescues.length}>
        <h2 className="text-body font-bold text-jaga-ink">{t("list.title")}</h2>
        {props.rescues.length === 0 && <p className={hint}>{t("list.none")}</p>}
        <div className="grid gap-5 lg:grid-cols-2">
          {props.rescues.map((r) => (
            <article key={r.id} className={card} data-field-record={r.status}>
              <p className="font-bold text-jaga-ink">
                {t("list.item", {
                  place: pickName(locale, r.tambonTh, r.tambonEn),
                  count: r.people,
                })}
                <span className={`block font-normal ${hint}`}>
                  {r.points > 0 ? t("list.points", { points: r.points }) : t("list.noPoints")}
                </span>
              </p>
              <Journey journey={fieldJourney(r)} compact />
              {r.status === "pending" && r.holds.length > 0 && (
                <ul className={`flex list-disc flex-col gap-1 ps-6 ${hint}`}>
                  {r.holds.map((hold) => (
                    <li key={hold}>{t(`holds.${hold}`)}</li>
                  ))}
                </ul>
              )}
              {r.reviewNote && (
                <p className={hint}>{t("list.adminNote", { note: r.reviewNote })}</p>
              )}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

/**
 * The phone's position, asked for at the moment the record is sent: "there and then" is the
 * owner's rule, so the form never sends a position it was merely shown some minutes ago.
 */
function freshPosition(): Promise<GeolocationPosition | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), {
      enableHighAccuracy: true,
      timeout: 20_000,
      maximumAge: 60_000,
    });
  });
}

export function FieldRescue({ unitId }: { unitId: string }) {
  const gps = useLocation({ start: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<FieldRescueViewProps["error"]>(null);
  const [result, setResult] = useState<FieldResult | null>(null);
  const [rescues, setRescues] = useState<MyFieldRescue[]>([]);
  const [round, setRound] = useState(0);
  const [waiting, setWaiting] = useState(0);
  const [saved, setSaved] = useState(false);

  const { point, state, locate } = gps;

  const load = useCallback(() => {
    fetch(FIELD_URL, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { rescues?: MyFieldRescue[] } | null) => {
        if (body?.rescues) setRescues(body.rescues);
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const flush = useCallback(() => {
    void flushFields().then(async (done) => {
      setWaiting((await waitingFields()).length);
      if (done.sent > 0) load();
    });
  }, [load]);

  // What was recorded without a signal goes out when the page opens and when the signal returns.
  useEffect(() => {
    flush();
    window.addEventListener("online", flush);
    return () => window.removeEventListener("online", flush);
  }, [flush]);

  const send: FieldRescueViewProps["onSend"] = async (form) => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const here = await freshPosition();
      if (!here) {
        setError("position");
        return;
      }
      const record = {
        id: crypto.randomUUID(),
        unitId,
        lat: here.coords.latitude,
        lon: here.coords.longitude,
        accuracy: Number.isFinite(here.coords.accuracy) ? here.coords.accuracy : null,
        // Some phones stamp a position with a clock of their own; never later than now.
        locatedAt: new Date(Math.min(here.timestamp, Date.now())).toISOString(),
        people: form.people,
        vulnerable: form.vulnerable,
        phone: form.phone,
        note: form.note,
      };
      const outcome = navigator.onLine
        ? await sendField({ ...record, photos: form.photos })
        : ({ kind: "later" } as const);
      if (outcome.kind === "sent") {
        setResult(outcome.result);
        load();
      } else if (outcome.kind === "later") {
        // No signal: everything taken here stays on the phone and is sent when it can be.
        await keepField(record, form.photos);
        setWaiting((await waitingFields()).length);
        setSaved(true);
      } else {
        const known = ["position", "phone", "people", "photo", "stale", "outside", "not_team"];
        setError(
          known.includes(outcome.error)
            ? (outcome.error as FieldRescueViewProps["error"])
            : "failed",
        );
      }
    } catch {
      setError("failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <FieldRescueView
      key={round}
      located={point ? { accuracy: gps.accuracy } : null}
      locating={state === "locating"}
      onLocate={locate}
      busy={busy}
      error={error}
      result={result}
      rescues={rescues}
      waiting={waiting}
      saved={saved}
      onFlush={flush}
      onSend={send}
      onAnother={() => {
        setResult(null);
        setSaved(false);
        setError(null);
        setRound((n) => n + 1);
        locate();
      }}
    />
  );
}
