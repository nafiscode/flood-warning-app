"use client";

import { useState } from "react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { MessageIcon } from "@/components/icons";
import { usePathname } from "@/i18n/navigation";
import {
  CHECK_STATES,
  PLACE_ROADS,
  PLACE_WATER,
  RESIDENT_CHECK_URL,
  loudest,
  type CheckState,
  type PlaceRoad,
  type PlaceWater,
  type ResidentsSaid,
} from "@/lib/place-checks";
import { signInHref } from "@/lib/sign-in-link";
import { BANGKOK_DATE_TIME } from "@/lib/time";
import { useSignedIn } from "@/lib/use-public";
import { buttonSecondary, errorNotice, hint, input, label } from "@/lib/ui";

/**
 * A resident saying what a safe place is like, from the place's own pin on the map or from its
 * card (the owner, 20 Oct). The people who know first that the hall is full are the ones standing
 * in it, and they will never register as a rescue team.
 *
 * What this can and cannot do is the whole design. It can tell everyone else, as an attributed
 * line, and it can put the place at the top of the covering team's round. It cannot move the
 * status on the card: a false "closed" turns people away from a dry shelter and a false "open"
 * sends somebody into a flooded one, so only an admin or a team covering the place writes that.
 * It never issues an alert and never notifies anybody (safety rule 2).
 */

/** The phone's position if it answers inside 5 s, else nothing. A check never waits on it. */
export function phonePosition(): Promise<{ lat: number; lon: number } | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      () => resolve(null),
      { timeout: 5000, maximumAge: 60_000 },
    );
  });
}

/**
 * What residents have said lately, as its own line in the page's own ink. Never an alert colour
 * and never the word verified: it says how many people, what they said and when, and leaves the
 * reader to weigh it against the status above (the same shape as a resident's flood report,
 * decision 13 Oct).
 */
export function ResidentsSaidLine({ said }: { said: ResidentsSaid | null }) {
  const t = useTranslations("placeChecks");
  const tPlaces = useTranslations("places");
  const format = useFormatter();
  if (!said) return null;
  const top = loudest(said);
  return (
    <p
      className={`flex items-start gap-1.5 ${hint}`}
      data-residents-said={top.state}
      data-residents-people={said.people}
      data-disputed={said.disputed ? "true" : "false"}
    >
      <MessageIcon size={18} aria-hidden="true" className="mt-0.5 shrink-0" />
      <span>
        {t("residentsSaid", { count: top.people, what: tPlaces(`status.${top.state}`) })}
        {said.latest && ` · ${format.dateTime(new Date(said.latest), BANGKOK_DATE_TIME)}`}
      </span>
    </p>
  );
}

type Props = {
  placeId: string;
  /** What the app currently says, so the person is correcting a statement, not filling a form. */
  status: string;
  /** Tight layout for the map's pop-up: no extra detail, just the three answers. */
  brief?: boolean;
};

/**
 * "Is this still right?" Signed in only (the owner's choice of 20 Oct): a check is not a cry for
 * help, so the reason an SOS has no door at all does not apply. A visitor is offered the way in
 * and told, in one line, what it is for.
 */
export function CheckThisPlace({ placeId, status, brief = false }: Props) {
  const t = useTranslations("placeChecks");
  const tPlaces = useTranslations("places");
  const locale = useLocale();
  const pathname = usePathname();
  const signedIn = useSignedIn();
  const [water, setWater] = useState<PlaceWater | null>(null);
  const [road, setRoad] = useState<PlaceRoad | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<CheckState | null>(null);
  const [sent, setSent] = useState<CheckState | null>(null);
  const [failed, setFailed] = useState<"rate" | "other" | null>(null);

  if (sent) {
    return (
      <p className={hint} data-place-check-sent={sent}>
        {t("thanks", { what: tPlaces(`status.${sent}`) })}
      </p>
    );
  }

  if (!signedIn) {
    return (
      <div className="flex flex-col gap-1" data-place-check="sign-in">
        <p className={hint}>{t("signInToCheck")}</p>
        <a href={signInHref(locale, pathname)} className={buttonSecondary}>
          {t("signIn")}
        </a>
      </div>
    );
  }

  async function send(open: CheckState) {
    setBusy(open);
    setFailed(null);
    const point = await phonePosition();
    try {
      const response = await fetch(RESIDENT_CHECK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: placeId,
          open,
          water,
          road,
          note: note.trim() || null,
          lat: point?.lat ?? null,
          lon: point?.lon ?? null,
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setFailed(body.error === "too_often" ? "rate" : "other");
        return;
      }
      setSent(open);
    } catch {
      setFailed("other");
    } finally {
      setBusy(null);
    }
  }

  return (
    <details className="flex flex-col" data-place-check={placeId}>
      <summary
        className={`${buttonSecondary} min-h-tap cursor-pointer list-none [&::-webkit-details-marker]:hidden`}
      >
        {t("askResident")}
      </summary>
      <div className="flex flex-col gap-3 pt-3">
        <p className={hint}>{t("listed", { status: tPlaces(`status.${status}`) })}</p>
        {!brief && (
          <>
            <Pick
              legend={t("water.label")}
              options={PLACE_WATER}
              chosen={water}
              onChoose={setWater}
              word={(w) => t(`water.${w}`)}
              name={`rwater-${placeId}`}
            />
            <Pick
              legend={t("roadLabel")}
              options={PLACE_ROADS}
              chosen={road}
              onChoose={setRoad}
              word={(r) => t(`roads.${r}`)}
              name={`rroad-${placeId}`}
            />
            <label className="flex flex-col gap-1">
              <span className={label}>{t("noteLabel")}</span>
              <input
                className={input}
                value={note}
                maxLength={200}
                onChange={(event) => setNote(event.target.value)}
              />
            </label>
          </>
        )}
        <fieldset className="flex flex-col gap-2">
          <legend className={`${label} pb-2`}>{t("ask")}</legend>
          {CHECK_STATES.map((option) => (
            <button
              key={option}
              type="button"
              disabled={busy !== null}
              data-place-check-send={option}
              className={buttonSecondary}
              onClick={() => void send(option)}
            >
              {busy === option ? t("sending") : tPlaces(`status.${option}`)}
            </button>
          ))}
        </fieldset>
        {failed && <p className={errorNotice}>{t(failed === "rate" ? "tooOften" : "failed")}</p>}
        <p className={hint}>{t("residentNote")}</p>
      </div>
    </details>
  );
}

/** One row of choices as radio buttons: saying nothing about the water is not a wrong answer. */
function Pick<T extends string>({
  legend,
  options,
  chosen,
  onChoose,
  word,
  name,
}: {
  legend: string;
  options: readonly T[];
  chosen: T | null;
  onChoose: (value: T) => void;
  word: (value: T) => string;
  name: string;
}) {
  return (
    <fieldset className="flex flex-col">
      <legend className={label}>{legend}</legend>
      {options.map((option) => (
        <label key={option} className="flex min-h-tap items-center gap-3">
          <input
            type="radio"
            name={name}
            className="size-6 accent-jaga-teal-ink"
            checked={chosen === option}
            onChange={() => onChoose(option)}
          />
          {word(option)}
        </label>
      ))}
    </fieldset>
  );
}
