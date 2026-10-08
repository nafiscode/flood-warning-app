"use client";

import { HomeView } from "@/components/home/HomeView";
import { DashboardView } from "@/components/map/DashboardView";
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
  homeExample,
  type HomeScenario,
} from "@/lib/dev-examples";

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
