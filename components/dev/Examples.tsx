"use client";

import { HomeView } from "@/components/home/HomeView";
import { DashboardView } from "@/components/map/DashboardView";
import { WeatherMapCanvas } from "@/components/weather/WeatherMapCanvas";
import { WeatherMapsView } from "@/components/weather/WeatherMapsView";
import { WeatherView } from "@/components/weather/WeatherView";
import { useState } from "react";
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
      maps={place ? <MapsExample /> : null}
    />
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
