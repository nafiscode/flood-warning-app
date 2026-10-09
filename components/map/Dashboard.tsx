"use client";

import type { Area, AreaDirectory } from "@/lib/area";
import { DAM_URL, type DamData } from "@/lib/dam";
import type { Hazard } from "@/lib/hazards";
import type { MapData } from "@/lib/map-data";
import { useOnPhone, useStored } from "@/lib/phone-store";
import { useFetched, useMyPlaces, useNow, usePublicStatus } from "@/lib/use-public";
import { DashboardView } from "./DashboardView";

/**
 * The live map dashboard: the same public, edge-cached answers for everyone (alert status, map
 * data, hazards, area names). The one personal thing is the person's own places, asked for with
 * their session only when this browser holds one (/api/me/places, never cached, never public);
 * they are drawn on the map for them alone.
 */
export function Dashboard({ transparency }: { transparency: boolean }) {
  const ready = useOnPhone();
  const { status, checkedAt, failed } = usePublicStatus();
  const hazards = useFetched<{ hazards: Hazard[] }>("/api/public/hazards");
  const directory = useFetched<AreaDirectory>("/api/geo/areas");
  const data = useFetched<MapData>("/api/public/map");
  // The dam, the reservoir and the path released water takes: public, edge-cached, and asked
  // for in every view because the river is always drawn (spec section 15).
  const dam = useFetched<DamData>(DAM_URL);
  const me = useMyPlaces();
  // Where the person said they are on the home screen: their saved home first, else the area
  // they chose on this phone. The map opens there (the owner's note, 9 Oct).
  const chosen = useStored<Area>("area");
  const area = me?.signedIn && me.home ? me.home : chosen;
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
      dams={dam.data?.dams ?? null}
      me={me}
      area={area}
      now={now}
      transparency={transparency}
      userAgent={ready ? navigator.userAgent : ""}
    />
  );
}
