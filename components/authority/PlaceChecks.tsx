"use client";

import { useState } from "react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { ClockIcon, PinIcon } from "@/components/icons";
import { ResidentsSaidLine, phonePosition } from "@/components/places/PlaceCheck";
import {
  CHECKS_URL,
  CHECK_STATES,
  PLACE_ROADS,
  PLACE_WATER,
  freshness,
  overdueHours,
  type CheckState,
  type PlaceRoad,
  type PlaceWater,
  type RoundPlace,
} from "@/lib/place-checks";
import { localName } from "@/lib/places";
import { BANGKOK_DATE_TIME } from "@/lib/time";
import { useFetched, useNow } from "@/lib/use-public";
import { buttonPrimary, buttonSecondary, errorNotice, hint, input, label } from "@/lib/ui";

/**
 * A team's round of the safe places it covers (owner, 20 Oct): the ones nobody has been to for
 * longest, first. Two taps to answer - open a place, tap what it is like - because this is done
 * standing in a car park on a phone, often in the rain.
 *
 * What the team says changes the place's live status and nothing else. Correcting the record
 * (the name, the capacity, what it is suitable for) stays an admin's job, and a check never
 * computes or publishes an alert (safety rule 2).
 */
export function PlaceChecks() {
  const t = useTranslations("placeChecks");
  const { data, state } = useFetched<{ places?: RoundPlace[]; error?: string }>(CHECKS_URL);
  // Checks sent in this visit, so a row answers without waiting for the whole list again.
  const [sent, setSent] = useState<Record<string, CheckState>>({});
  const now = useNow();

  if (state === "loading") return <p className={hint}>{t("loading")}</p>;
  // A caller without a verified team is turned away by the page before this is drawn, and the
  // database function refuses them again; here that only ever arrives as "could not load".
  const places = data?.places;
  if (!places) return <p className={errorNotice}>{t("unavailable")}</p>;
  if (places.length === 0) return <p className={hint}>{t("none")}</p>;

  // useNow() is 0 only on the server, and the list is not drawn there: every return above this
  // line fires while the request is still in flight.
  const at = new Date(now);
  const due = places.filter(
    (p) => !sent[p.id] && (p.checkedAt === null || (overdueHours(p, at) ?? 0) > 0),
  );
  return (
    <div className="flex flex-col gap-4">
      <p className={due.length === 0 ? hint : "font-medium"} data-round-due={due.length}>
        {due.length === 0
          ? t("allFresh", { count: places.length })
          : t("dueCount", { count: due.length, total: places.length })}
      </p>
      <ul className="flex flex-col gap-3">
        {places.map((place) => (
          <PlaceRow
            key={place.id}
            place={place}
            now={at}
            sentState={sent[place.id] ?? null}
            onSent={(open) => setSent((was) => ({ ...was, [place.id]: open }))}
          />
        ))}
      </ul>
      <p className={hint}>{t("note")}</p>
    </div>
  );
}

type RowProps = {
  place: RoundPlace;
  now: Date;
  sentState: CheckState | null;
  onSent: (open: CheckState) => void;
};

function PlaceRow({ place, now, sentState, onSent }: RowProps) {
  const t = useTranslations("placeChecks");
  const tPlaces = useTranslations("places");
  const format = useFormatter();
  const locale = useLocale();
  const [water, setWater] = useState<PlaceWater | null>(null);
  const [road, setRoad] = useState<PlaceRoad | null>(null);
  const [needs, setNeeds] = useState("");
  const [busy, setBusy] = useState<CheckState | null>(null);
  const [failed, setFailed] = useState(false);

  const checked = freshness({
    checkedAt: place.checkedAt,
    source: place.checkedSource,
    dueAt: place.dueAt,
    now,
  });
  const over = overdueHours(place, now);

  async function send(open: CheckState) {
    setBusy(open);
    setFailed(false);
    // Where the person is, if the phone will say quickly. A check is worth having without it,
    // so nothing waits on the position for more than a moment.
    const point = await phonePosition();
    try {
      const response = await fetch(CHECKS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: place.id,
          open,
          water,
          road,
          needs: needs.trim() || null,
          lat: point?.lat ?? null,
          lon: point?.lon ?? null,
        }),
      });
      if (!response.ok) throw new Error(String(response.status));
      onSent(open);
    } catch {
      setFailed(true);
    } finally {
      setBusy(null);
    }
  }

  if (sentState) {
    return (
      <li
        className="rounded-xl border border-jaga-line bg-jaga-ground p-4"
        data-round-place={place.id}
        data-round-sent={sentState}
      >
        <p className="font-medium">{localName(place.name, locale)}</p>
        <p className={hint}>{t("sent", { status: tPlaces(`status.${sentState}`) })}</p>
      </li>
    );
  }

  return (
    <li data-round-place={place.id} data-round-state={checked.state}>
      <details className="rounded-xl border border-jaga-line bg-jaga-surface">
        <summary className="min-h-tap cursor-pointer list-none p-4 [&::-webkit-details-marker]:hidden">
          <span className="font-medium">{localName(place.name, locale)}</span>
          <span className={`block ${hint}`}>
            {tPlaces(`type.${place.type}`)} ·{" "}
            {locale === "en" ? place.tambonEn : place.tambonTh || place.tambonEn}
          </span>
          {place.residentsSaid?.disputed && (
            <span className={`block font-medium`} data-round-disputed="true">
              {t("disputed")}
            </span>
          )}
          <span className={`mt-1 flex items-center gap-1.5 ${hint}`} data-round-age="true">
            <ClockIcon size={18} aria-hidden="true" />
            {checked.state === "never"
              ? t("never")
              : over && over > 0
                ? t("overdue", {
                    hours: over,
                    time: format.dateTime(new Date(checked.at), BANGKOK_DATE_TIME),
                  })
                : t("checked", {
                    time: format.dateTime(new Date(checked.at), BANGKOK_DATE_TIME),
                  })}
          </span>
        </summary>
        <div className="flex flex-col gap-3 border-t border-jaga-line p-4">
          {/* What residents have said about it. A place two or more of them dispute is first in
              the round (migration ..a10_resident_place_checks), so this is the top of the list. */}
          <ResidentsSaidLine said={place.residentsSaid} />
          <p className={hint}>
            {t("listed", { status: tPlaces(`status.${place.status}`) })}
            {place.capacity !== null && ` · ${tPlaces("capacity", { count: place.capacity })}`}
          </p>
          {place.needs && <p className={hint}>{tPlaces("needs", { text: place.needs })}</p>}
          <details className="flex flex-col">
            <summary
              className={`${buttonSecondary} min-h-tap cursor-pointer list-none [&::-webkit-details-marker]:hidden`}
            >
              {t("more")}
            </summary>
            <div className="flex flex-col gap-3 pt-3">
              <Choice
                legend={t("water.label")}
                options={PLACE_WATER}
                chosen={water}
                onChoose={setWater}
                word={(w) => t(`water.${w}`)}
                name={`water-${place.id}`}
              />
              <Choice
                legend={t("roadLabel")}
                options={PLACE_ROADS}
                chosen={road}
                onChoose={setRoad}
                word={(r) => t(`roads.${r}`)}
                name={`road-${place.id}`}
              />
              <label className="flex flex-col gap-1">
                <span className={label}>{t("needsLabel")}</span>
                <input
                  className={input}
                  value={needs}
                  maxLength={200}
                  onChange={(event) => setNeeds(event.target.value)}
                />
              </label>
            </div>
          </details>
          <fieldset className="flex flex-col gap-2">
            <legend className={`${label} pb-2`}>{t("ask")}</legend>
            {CHECK_STATES.map((option) => (
              <button
                key={option}
                type="button"
                disabled={busy !== null}
                data-round-send={option}
                className={option === place.status ? buttonPrimary : buttonSecondary}
                onClick={() => void send(option)}
              >
                {busy === option ? t("sending") : tPlaces(`status.${option}`)}
              </button>
            ))}
          </fieldset>
          {failed && <p className={errorNotice}>{t("failed")}</p>}
          <a
            href={`geo:${place.lat},${place.lon}?q=${place.lat},${place.lon}`}
            className={`flex items-center gap-2 ${hint}`}
            data-round-navigate={place.id}
          >
            <PinIcon size={18} aria-hidden="true" />
            {t("where")}
          </a>
        </div>
      </details>
    </li>
  );
}

/** One row of choices, as radio buttons: a check that says nothing about the water is not wrong. */
function Choice<T extends string>({
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
