"use client";

import { useLocale, useTranslations } from "next-intl";
import { useId, useRef, useState } from "react";
import { entryToArea, type Area, type AreaDirectory } from "@/lib/area";
import { lookupLocation, rowsFromDirectory, type Lookup } from "@/lib/location-lookup";
import { useOnPhone } from "@/lib/phone-store";
import { readPlaceInput, type Point } from "@/lib/place-input";
import { searchDirectory, type DirectoryRow, type FoundPlace } from "@/lib/place-search";
import { buttonSecondary, hint, input as inputStyle, label as labelStyle } from "@/lib/ui";

/**
 * What the box found. `area` is set when the person picked one of Jaga's tambons by name (the
 * point is then the middle of it); it is null for coordinates, where the point is exact and must
 * stay exact - the SOS pin map sends it as it is.
 */
export type FoundLocation = { point: Point; area: Area | null };

type Directory = { directory: AreaDirectory; rows: DirectoryRow[] };

type Status =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "say"; what: "none" | "failed" | "offline" | "shortLink" | "unknownLink" | "pinned" };

/**
 * Finding a place without an account (the owner, 23 Oct 2026): paste the exact latitude and
 * longitude copied from a map, or type a tambon or district name. It is the visitor's version of
 * the "find the place" box on the account pages (components/account/PlaceFinder.tsx).
 * Coordinates are read in the browser, so pasting works with no signal. A name goes to
 * /api/geo/search, which looks through Jaga's tambons and then landmarks (a university, a
 * market, a mosque); the owner asked on 24 Oct that visitors get landmarks too, after finding that
 * the tambon list alone answered nothing for a name like Prince of Songkla University. If that
 * cannot be asked, the tambon list in this browser still answers
 * (lib/location-lookup.ts). The name search searches when the button is pressed, never while
 * typing.
 *
 * It only ever proposes a place; the caller decides what to do with it. Nothing here is ever a
 * step in front of an SOS: it is an extra way to say where.
 */
export function LocationFinder({ onFound }: { onFound: (found: FoundLocation) => void }) {
  const t = useTranslations("locationFinder");
  const locale = useLocale();
  const inputId = useId();
  const [value, setValue] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [results, setResults] = useState<FoundPlace[] | null>(null);
  const loaded = useRef<Directory | null>(null);
  // Only the newest question may answer: a slow list must not overwrite a later paste.
  const asked = useRef(0);
  const onPhone = useOnPhone();
  const canPaste = onPhone && typeof navigator.clipboard?.readText === "function";

  /** Jaga's tambons, fetched once and only when a name needs them (a pasted point never does). */
  async function directory(): Promise<Directory | null> {
    if (loaded.current) return loaded.current;
    try {
      const response = await fetch("/api/geo/areas", { cache: "no-store" });
      if (!response.ok) throw new Error(String(response.status));
      const directory = (await response.json()) as AreaDirectory;
      loaded.current = { directory, rows: rowsFromDirectory(directory) };
      return loaded.current;
    } catch {
      return null;
    }
  }

  function deliver(point: Point, code?: string) {
    let area: Area | null = null;
    const list = loaded.current?.directory;
    if (code && list) {
      const entry = list.tambons.find((x) => x.code === code);
      const province = entry && list.provinces.find((x) => x.code === entry.provinceCode);
      if (entry && province) area = entryToArea(entry, province, "list");
    }
    setResults(null);
    setStatus({ kind: "say", what: "pinned" });
    onFound({ point, area });
  }

  function show(found: Lookup) {
    switch (found.kind) {
      case "empty":
        setStatus({ kind: "idle" });
        return;
      case "point":
        deliver(found.point);
        return;
      case "shortLink":
      case "unknownLink":
        setStatus({ kind: "say", what: found.kind });
        return;
      case "places":
        if (found.places.length === 0) setStatus({ kind: "say", what: "none" });
        else {
          setResults(found.places);
          setStatus({ kind: "idle" });
        }
        return;
      case "needsDirectory":
        setStatus({ kind: "say", what: "offline" });
    }
  }

  /** A name: Jaga's tambons and landmarks from the server, else the tambons held here. */
  async function searchByName(query: string, turn: number) {
    setStatus({ kind: "busy" });
    // Asked beside the search, so a tambon picked from the answer can be handed over as an area.
    const listing = directory();
    try {
      const params = new URLSearchParams({ q: query, lang: locale });
      const response = await fetch(`/api/geo/search?${params}`);
      if (!response.ok) throw new Error(String(response.status));
      const answer = (await response.json()) as { places: FoundPlace[]; partial: boolean };
      await listing;
      if (asked.current !== turn) return;
      if (answer.places.length > 0) {
        setResults(answer.places);
        setStatus({ kind: "idle" });
      } else {
        // Landmarks not looked through is not "no such place".
        setStatus({ kind: "say", what: answer.partial ? "failed" : "none" });
      }
    } catch {
      const list = await listing;
      if (asked.current !== turn) return;
      const places = list ? searchDirectory(query, list.rows, locale) : [];
      if (places.length > 0) {
        setResults(places);
        setStatus({ kind: "idle" });
      } else setStatus({ kind: "say", what: list ? "failed" : "offline" });
    }
  }

  async function run(raw: string) {
    const turn = (asked.current += 1);
    setResults(null);
    const read = readPlaceInput(raw);
    if (read.kind === "search") {
      await searchByName(read.query, turn);
      return;
    }
    let found = lookupLocation(raw, loaded.current?.rows ?? null, locale);
    if (found.kind === "needsDirectory") {
      setStatus({ kind: "busy" });
      const list = await directory();
      if (asked.current !== turn) return;
      found = list ? lookupLocation(raw, list.rows, locale) : found;
    }
    show(found);
  }

  async function paste() {
    try {
      const copied = await navigator.clipboard.readText();
      if (copied.trim() === "") return;
      setValue(copied.trim().slice(0, 600));
      void run(copied);
    } catch {
      // The browser said no, or there is nothing to paste: the box is still there to type in.
    }
  }

  const busy = status.kind === "busy";
  return (
    <div className="flex flex-col gap-2" data-location-finder="true">
      <label htmlFor={inputId} className={labelStyle}>
        {t("label")}
      </label>
      <p className={hint}>{t("hint")}</p>
      <input
        id={inputId}
        type="text"
        inputMode="text"
        enterKeyHint="search"
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        value={value}
        maxLength={600}
        placeholder={t("placeholder")}
        // The list is fetched as soon as the box is used, so a name answers quickly.
        onFocus={() => void directory()}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          // The box may sit inside a form: Enter looks for the place, it never submits.
          if (event.key === "Enter") {
            event.preventDefault();
            void run(value);
          }
        }}
        // Pasting numbers is the whole point for most people, so it needs no second tap.
        onPaste={(event) => {
          const pasted = event.clipboardData.getData("text");
          if (readPlaceInput(pasted).kind === "point") {
            event.preventDefault();
            setValue(pasted.trim().slice(0, 600));
            void run(pasted);
          }
        }}
        className={inputStyle}
      />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void run(value)}
          disabled={busy || value.trim() === ""}
          data-finder-search="true"
          className={`${buttonSecondary} flex-1`}
        >
          {busy ? t("searching") : t("search")}
        </button>
        {canPaste && (
          <button
            type="button"
            onClick={() => void paste()}
            disabled={busy}
            data-finder-paste="true"
            className={`${buttonSecondary} flex-1`}
          >
            {t("paste")}
          </button>
        )}
      </div>

      <p
        role="status"
        className={status.kind === "say" ? "font-medium" : hint}
        data-finder-status={status.kind === "say" ? status.what : status.kind}
      >
        {status.kind === "say" && t(status.what)}
      </p>

      {results && results.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="font-medium">{t("results")}</p>
          <ul className="flex flex-col gap-2">
            {results.map((place) => (
              <li key={place.code ?? `${place.lat}:${place.lon}:${place.name}`}>
                <button
                  type="button"
                  onClick={() => deliver({ lat: place.lat, lon: place.lon }, place.code)}
                  data-finder-result={place.code ?? place.source}
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
        </div>
      )}
    </div>
  );
}
