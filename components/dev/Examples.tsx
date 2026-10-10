"use client";

import { HomeView } from "@/components/home/HomeView";
import { DashboardView } from "@/components/map/DashboardView";
import { DamCard, DamNotice } from "@/components/map/Dam";
import { MapView } from "@/components/map/MapView";
import { WeatherScene } from "@/components/weather/WeatherScene";
import { SCENE_INK, SCENE_LOOKS, SCENES, scrim } from "@/lib/weather-scene";
import { WeatherMapCanvas } from "@/components/weather/WeatherMapCanvas";
import { WeatherMapsView } from "@/components/weather/WeatherMapsView";
import { WeatherView } from "@/components/weather/WeatherView";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { DAM_URL, type Dam, type DamData } from "@/lib/dam";
import { useFetched } from "@/lib/use-public";
import { areaName } from "@/lib/area";
import {
  BANA,
  EXAMPLE_DIRECTORY,
  EXAMPLE_HAZARDS,
  EXAMPLE_MAP,
  EXAMPLE_ME,
  EXAMPLE_NOW,
  EXAMPLE_PLACES,
  exampleAlert,
  exampleStatus,
  EXAMPLE_GRID,
  EXAMPLE_PINS,
  EXAMPLE_WEATHER,
  EXAMPLE_WEATHER_PLACE,
  DAM_SCENARIOS,
  exampleDamSignal,
  type DamScenario,
  homeExample,
  type HomeScenario,
  type WeatherScenario,
} from "@/lib/dev-examples";
import type { WeatherPlace } from "@/lib/weather";
import type { WeatherField } from "@/lib/weather-grid";

/** One home-screen example, fed with made-up data instead of the live status. */
export function HomeExample({ scenario }: { scenario: HomeScenario }) {
  const example = homeExample(scenario);
  return (
    <HomeView
      ready
      status={example.status}
      checkedAt={example.status ? EXAMPLE_NOW - 60_000 : null}
      failed={example.failed}
      area={example.area}
      me={example.me}
      places={EXAMPLE_PLACES}
      placesState="ok"
      now={EXAMPLE_NOW}
      onChooseArea={() => {}}
      onRetry={() => {}}
      projectLine={null}
    />
  );
}

/** The map with made-up alerts, reports, places, a gauge and two watched places. */
export function MapExample() {
  return (
    <DashboardView
      status={exampleStatus([
        exampleAlert("evacuate", ["940111", "940112"]),
        exampleAlert("warning", [BANA.code, "940105"], {
          issuedAt: new Date(EXAMPLE_NOW - 400 * 60_000).toISOString(),
          nextUpdateAt: new Date(EXAMPLE_NOW - 150 * 60_000).toISOString(),
        }),
        exampleAlert("watch", ["940101", "940102", "940103"]),
      ])}
      checkedAt={EXAMPLE_NOW - 60_000}
      failed={false}
      hazards={EXAMPLE_HAZARDS}
      hazardsState="ok"
      directory={EXAMPLE_DIRECTORY}
      directoryState="ok"
      data={EXAMPLE_MAP}
      dataState="ok"
      me={EXAMPLE_ME}
      now={EXAMPLE_NOW}
      transparency={false}
      initialProvince="94"
    />
  );
}

/** The weather page with a made-up forecast: full, with no place chosen yet, and offline. */
export function WeatherExample({ scenario }: { scenario: WeatherScenario }) {
  const [place, setPlace] = useState<WeatherPlace | null>(
    scenario === "choose" ? null : EXAMPLE_WEATHER_PLACE,
  );
  return (
    <WeatherView
      ready
      place={place}
      detail={place?.from === "area" ? areaName("th", BANA) : null}
      weather={place ? EXAMPLE_WEATHER : null}
      fetchedAt={EXAMPLE_NOW - 4 * 60_000}
      failed={scenario === "offline"}
      now={EXAMPLE_NOW}
      picking={false}
      onPick={() => setPlace(null)}
      onChoose={setPlace}
      onCancelPick={() => {}}
      onRetry={() => {}}
      maps={scenario === "skies" ? <SkiesExample /> : place ? <MapsExample /> : null}
    />
  );
}

/**
 * Every sky, side by side: the one place to judge the moving skies without waiting for the
 * weather to do it. The moon is drawn four times, a week apart, so its shapes can be seen too.
 */
function SkiesExample() {
  const week = 7 * 24 * 60 * 60_000;
  return (
    <div className="flex flex-col gap-4">
      <ul className="grid grid-cols-2 gap-3">
        {SCENES.map((scene) => (
          <li
            key={scene}
            className="relative isolate h-32 overflow-hidden rounded-xl border border-jaga-line"
          >
            <WeatherScene scene={scene} now={EXAMPLE_NOW} />
            <span
              className="absolute inset-0"
              style={{ background: scrim(SCENE_LOOKS[scene].ink) }}
            />
            <span
              className="absolute bottom-2 start-2 text-small font-medium"
              style={{ color: SCENE_INK[SCENE_LOOKS[scene].ink] }}
            >
              {scene}
            </span>
          </li>
        ))}
      </ul>
      <ul className="grid grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((n) => (
          <li
            key={n}
            className="relative isolate h-24 overflow-hidden rounded-xl border border-jaga-line"
          >
            <WeatherScene scene="clearNight" now={EXAMPLE_NOW + n * week} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The weather maps with the made-up grid: the real screen, no network behind it but the basemap. */
function MapsExample() {
  const [field, setField] = useState<WeatherField>("rain");
  const [hour, setHour] = useState(0);
  return (
    <WeatherMapsView
      grid={EXAMPLE_GRID}
      state="ok"
      field={field}
      onField={setField}
      hour={hour}
      onHour={setHour}
      playing={false}
      onPlaying={() => {}}
      places={EXAMPLE_PINS}
      canvas={
        <WeatherMapCanvas
          grid={EXAMPLE_GRID}
          field={field}
          hour={hour}
          places={EXAMPLE_PINS}
          centre={{ lat: EXAMPLE_GRID.lat, lon: EXAMPLE_GRID.lon }}
          onViewSpan={() => {}}
          text={{ loading: "…", failed: "—" }}
        />
      }
    />
  );
}

/**
 * The dam in each state it can be in. The river, the reservoir and the tambon list are the real
 * ones, read from /api/public/dam; only the figures are made up, because a release happens in a
 * handful of hours a year and the quiet notice would otherwise never be seen before it matters.
 */
export function DamExample() {
  const t = useTranslations("devHome");
  const [scenario, setScenario] = useState<DamScenario>("releasing");
  const locale = useLocale();
  const { data, state } = useFetched<DamData>(DAM_URL);
  const tDam = useTranslations("dam");
  const base = data?.dams[0] ?? null;
  const dam: Dam | null = base ? { ...base, signal: exampleDamSignal(scenario) } : null;
  return (
    <div className="flex flex-col gap-4">
      <div role="group" aria-label={t("damScenarioLabel")} className="flex flex-wrap gap-2">
        {DAM_SCENARIOS.map((name) => (
          <button
            key={name}
            type="button"
            aria-pressed={scenario === name}
            data-dam-scenario={name}
            onClick={() => setScenario(name)}
            className={`inline-flex min-h-tap items-center rounded-full border-2 px-4 py-1 font-medium ${
              scenario === name
                ? "border-jaga-edge bg-jaga-slate text-white"
                : "border-jaga-edge bg-jaga-surface text-jaga-ink"
            }`}
          >
            {t(`damScenario.${name}`)}
          </button>
        ))}
      </div>
      {state === "unavailable" && <p>{tDam("figures.none")}</p>}
      {dam && (
        <>
          <DamNotice dam={dam} via="main" tambonName={BANA.nameTh} now={EXAMPLE_NOW} />
          <MapView
            layers={[]}
            status={null}
            data={null}
            now={EXAMPLE_NOW}
            onSelect={() => {}}
            text={{ loading: "…", failed: "—" }}
            dams={[dam]}
            damText={{
              spillway: tDam("mark.spillway"),
              outlet: tDam("mark.outlet"),
              locale,
            }}
          />
          <DamCard dam={dam} now={EXAMPLE_NOW} />
        </>
      )}
    </div>
  );
}
