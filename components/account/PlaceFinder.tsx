"use client";

import { useRef, useState } from "react";
import { readPlaceInput, type Point } from "@/lib/place-input";
import type { FoundPlace } from "@/lib/place-search";
import { useOnPhone } from "@/lib/phone-store";
import { buttonSecondary, hint, input as inputStyle, label as labelStyle } from "@/lib/ui";

/** Every word of the box, handed in by the server page so no messages travel for it. */
export type FinderText = {
  label: string;
  hint: string;
  placeholder: string;
  search: string;
  paste: string;
  searching: string;
  resolving: string;
  results: string;
  none: string;
  failed: string;
  partial: string;
  linkFailed: string;
  unknownLink: string;
  pinned: string;
  inArea: string;
  notCovered: string;
  outside: string;
  credit: string;
  howTitle: string;
  how: string[];
};

type Status =
  | { kind: "idle" }
  | { kind: "busy"; what: "searching" | "resolving" }
  | { kind: "say"; what: "none" | "failed" | "linkFailed" | "unknownLink" | "pinned" };

/**
 * One box for finding a place (the owner's request, 12 Oct): type a name, or paste whatever you
 * have — numbers copied from a map, a link somebody shared, the short code Google Maps shows for
 * a house without an address. It works out which, so nobody has to know the difference.
 *
 * It only ever proposes a point. The pin still goes on the map where the person can see it and
 * move it, because a search lands on the village, not on the house.
 */
export function PlaceFinder({
  text,
  locale,
  near,
  onPick,
}: {
  text: FinderText;
  locale: string;
  /** Where the map is looking, for completing a short code that names no town. */
  near: () => Point | null;
  onPick: (point: Point) => void;
}) {
  const [value, setValue] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [found, setFound] = useState<{ places: FoundPlace[]; partial: boolean } | null>(null);
  // Only the newest question may answer: a slow search must not overwrite a later paste.
  const asked = useRef(0);
  const onPhone = useOnPhone();
  const canPaste = onPhone && typeof navigator.clipboard?.readText === "function";

  const pick = (point: Point) => {
    setFound(null);
    setStatus({ kind: "say", what: "pinned" });
    onPick(point);
  };

  async function search(query: string, turn: number) {
    setStatus({ kind: "busy", what: "searching" });
    const params = new URLSearchParams({ q: query, lang: locale });
    const from = near();
    if (from) {
      params.set("lat", from.lat.toFixed(4));
      params.set("lon", from.lon.toFixed(4));
    }
    try {
      const response = await fetch(`/api/geo/search?${params}`);
      if (!response.ok) throw new Error(String(response.status));
      const answer = (await response.json()) as { places: FoundPlace[]; partial: boolean };
      if (asked.current !== turn) return;
      // A code names one spot: there is nothing to choose between.
      if (answer.places.length === 1 && answer.places[0]!.source === "code") {
        pick(answer.places[0]!);
        return;
      }
      setFound(answer);
      setStatus(answer.places.length === 0 ? { kind: "say", what: "none" } : { kind: "idle" });
    } catch {
      if (asked.current === turn) setStatus({ kind: "say", what: "failed" });
    }
  }

  async function follow(url: string, turn: number) {
    setStatus({ kind: "busy", what: "resolving" });
    try {
      const response = await fetch("/api/geo/resolve-link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      if (!response.ok) throw new Error(String(response.status));
      const answer = (await response.json()) as { point: Point | null };
      if (asked.current !== turn) return;
      if (answer.point) pick(answer.point);
      else setStatus({ kind: "say", what: "linkFailed" });
    } catch {
      if (asked.current === turn) setStatus({ kind: "say", what: "linkFailed" });
    }
  }

  function run(raw: string) {
    const turn = (asked.current += 1);
    setFound(null);
    const read = readPlaceInput(raw);
    if (read.kind === "empty") setStatus({ kind: "idle" });
    else if (read.kind === "point") pick(read.point);
    else if (read.kind === "unknownLink") setStatus({ kind: "say", what: "unknownLink" });
    else if (read.kind === "shortLink") void follow(read.url, turn);
    else void search(read.kind === "search" ? read.query : raw, turn);
  }

  async function paste() {
    try {
      const copied = await navigator.clipboard.readText();
      if (copied.trim() === "") return;
      setValue(copied.trim().slice(0, 600));
      run(copied);
    } catch {
      // The browser said no, or there is nothing to paste: the box is still there to type in.
    }
  }

  const busy = status.kind === "busy";
  return (
    <div className="flex flex-col gap-2" data-place-finder="true">
      <label htmlFor="place-finder" className={labelStyle}>
        {text.label}
      </label>
      <p className={hint}>{text.hint}</p>
      <input
        id="place-finder"
        type="text"
        inputMode="text"
        enterKeyHint="search"
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        value={value}
        maxLength={600}
        placeholder={text.placeholder}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          // The box lives inside the page's own form: Enter must look for the place, not save.
          if (event.key === "Enter") {
            event.preventDefault();
            run(value);
          }
        }}
        // Pasting is the whole point for most people, so it needs no second tap.
        onPaste={(event) => {
          const pasted = event.clipboardData.getData("text");
          const read = readPlaceInput(pasted);
          if (read.kind === "point" || read.kind === "shortLink") {
            event.preventDefault();
            setValue(pasted.trim().slice(0, 600));
            run(pasted);
          }
        }}
        className={inputStyle}
      />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => run(value)}
          disabled={busy || value.trim() === ""}
          data-finder-search="true"
          className={`${buttonSecondary} flex-1`}
        >
          {busy ? text[status.what] : text.search}
        </button>
        {canPaste && (
          <button
            type="button"
            onClick={() => void paste()}
            disabled={busy}
            data-finder-paste="true"
            className={`${buttonSecondary} flex-1`}
          >
            {text.paste}
          </button>
        )}
      </div>

      <p
        role="status"
        className={status.kind === "say" ? "font-medium" : hint}
        data-finder-status={status.kind === "say" ? status.what : status.kind}
      >
        {status.kind === "say" && text[status.what]}
      </p>

      {found && found.places.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="font-medium">{text.results}</p>
          <ul className="flex flex-col gap-2">
            {found.places.map((place) => (
              <li key={`${place.source}:${place.lat}:${place.lon}:${place.name}`}>
                <button
                  type="button"
                  onClick={() => pick(place)}
                  data-finder-result={place.source}
                  className="flex min-h-tap w-full flex-col items-start rounded-xl border border-jaga-edge bg-jaga-surface px-4 py-2 text-start"
                >
                  <span className="font-medium text-jaga-ink">{place.name}</span>
                  {place.detail !== "" && (
                    <span className="text-small text-jaga-text-2">{place.detail}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
          {found.partial && <p className={hint}>{text.partial}</p>}
          <p className={hint}>{text.credit}</p>
        </div>
      )}

      <details className="rounded-xl border border-jaga-line px-4">
        <summary className="flex min-h-tap cursor-pointer items-center font-medium text-jaga-ink">
          {text.howTitle}
        </summary>
        <ol className="mb-3 flex list-decimal flex-col gap-1 ps-5">
          {text.how.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </details>
    </div>
  );
}
