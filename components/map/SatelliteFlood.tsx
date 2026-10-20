"use client";

import { useFormatter, useTranslations } from "next-intl";
import { CrossIcon } from "@/components/icons";
import {
  SATELLITE_DEFAULT,
  SATELLITE_WINDOWS,
  satelliteColor,
  satelliteState,
  type SatelliteFlood,
  type SatelliteWindow,
} from "@/lib/satellite-flood";
import { BANGKOK_DATE_TIME } from "@/lib/time";
import { checkBox, checkRow, hint, notice } from "@/lib/ui";
import type { LoadState } from "@/lib/use-public";

/** A pass's day as people read it. The day is GISTDA's own, so it is not shifted between zones. */
const PASS_DAY = { day: "numeric", month: "short", timeZone: "UTC" } as const;

/**
 * The switch for the flood GISTDA's satellites saw, how far back to look, and what the answer
 * means in words. It is off until asked for. Every state says what it is not: an empty map is not
 * an all-clear, and a failed request says nothing about flooding (safety rules 8 and 10).
 */
export function SatelliteFloodPanel({
  days,
  onDays,
  flood,
  load,
  dark,
}: {
  /** The window being shown; null while the layer is off. */
  days: SatelliteWindow | null;
  onDays: (days: SatelliteWindow | null) => void;
  flood: SatelliteFlood | null;
  load: LoadState;
  dark: boolean;
}) {
  const t = useTranslations("map.satellite");
  const format = useFormatter();
  const state = satelliteState(days, load, flood);
  const latest = flood?.passDays[0];
  return (
    <div className="flex flex-col gap-2" data-satellite={state}>
      <label
        data-satellite-toggle="true"
        className={`${checkRow} items-center rounded-xl border-2 border-jaga-edge bg-jaga-surface px-3 font-bold`}
      >
        <input
          type="checkbox"
          className={`${checkBox} mt-0`}
          checked={days !== null}
          onChange={(event) => onDays(event.target.checked ? SATELLITE_DEFAULT : null)}
        />
        <span
          aria-hidden="true"
          className="size-5 shrink-0 rounded-[4px] border border-jaga-edge"
          style={{ backgroundColor: satelliteColor(dark) }}
        />
        <span>{t("toggle")}</span>
      </label>
      {days !== null && (
        <>
          <fieldset className="flex flex-col gap-1">
            <legend className="font-medium">{t("window")}</legend>
            <div className="flex flex-wrap gap-2">
              {SATELLITE_WINDOWS.map((choice) => (
                <button
                  key={choice}
                  type="button"
                  data-satellite-days={choice}
                  aria-pressed={days === choice}
                  onClick={() => onDays(choice)}
                  className={`min-h-tap rounded-full border-2 px-4 font-bold ${
                    days === choice
                      ? "border-jaga-edge bg-jaga-slate text-white"
                      : "border-jaga-line bg-jaga-surface"
                  }`}
                >
                  {t("days", { days: choice })}
                </button>
              ))}
            </div>
          </fieldset>
          <div
            role="status"
            className={`${notice} flex flex-col gap-1`}
            data-satellite-status={state}
          >
            {state === "loading" && <p>{t("loading")}</p>}
            {state === "unavailable" && <p>{t("failed")}</p>}
            {state === "none" && <p>{t("none", { days })}</p>}
            {state === "some" && flood && (
              <p>
                {t("some", { days, km2: format.number(flood.km2, { maximumFractionDigits: 1 }) })}
              </p>
            )}
            {(state === "some" || state === "none") && flood && (
              <p className={hint}>
                {latest
                  ? t("latest", {
                      day: format.dateTime(new Date(`${latest}T00:00:00Z`), PASS_DAY),
                      asked: format.dateTime(new Date(flood.fetchedAt), BANGKOK_DATE_TIME),
                    })
                  : t("asked", {
                      asked: format.dateTime(new Date(flood.fetchedAt), BANGKOK_DATE_TIME),
                    })}
              </p>
            )}
            {state === "some" && flood?.truncated && <p className={hint}>{t("truncated")}</p>}
            <p className={hint} data-satellite-note="true">
              {t("note")}
            </p>
          </div>
          {/*
           * Closing the layer from under its own detail (the owner, 20 Oct 2026). It is the same
           * thing the switch above does - the caller puts the map back where it was and brings
           * the flood-risk classes back with it - but it is here, at the end of what the reader
           * has just read, rather than back up at the top of the panel.
           */}
          <button
            type="button"
            data-satellite-close="true"
            onClick={() => onDays(null)}
            className="inline-flex min-h-tap items-center justify-center gap-2 self-start rounded-xl border-2 border-jaga-line bg-jaga-surface px-4 font-bold"
          >
            <CrossIcon />
            {t("close")}
          </button>
        </>
      )}
    </div>
  );
}
