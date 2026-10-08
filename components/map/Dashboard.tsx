"use client";

import type { AreaDirectory } from "@/lib/area";
import type { Hazard } from "@/lib/hazards";
import type { MapData } from "@/lib/map-data";
import { useOnPhone } from "@/lib/phone-store";
import { useFetched, useNow, usePublicStatus } from "@/lib/use-public";
import { DashboardView } from "./DashboardView";

/**
 * The live map dashboard: the same public, edge-cached answers for everyone (alert status, map
 * data, hazards, area names). Nothing personal is asked for here.
 */
export function Dashboard({ transparency }: { transparency: boolean }) {
  const ready = useOnPhone();
  const { status, checkedAt, failed } = usePublicStatus();
  const hazards = useFetched<{ hazards: Hazard[] }>("/api/public/hazards");
  const directory = useFetched<AreaDirectory>("/api/geo/areas");
  const data = useFetched<MapData>("/api/public/map");
  const now = useNow();
  return (
    <DashboardView
      status={status}
      checkedAt={checkedAt}
      failed={failed}
      hazards={hazards.data?.hazards ?? null}
      hazardsState={hazards.state}
      directory={directory.data}
      directoryState={directory.state}
      data={data.data}
      dataState={data.state}
      now={now}
      transparency={transparency}
      userAgent={ready ? navigator.userAgent : ""}
    />
  );
}
