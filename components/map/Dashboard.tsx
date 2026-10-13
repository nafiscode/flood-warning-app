"use client";

import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

import { hazardSourceUrl, tilesBase, type TileManifest } from "@/lib/hazard-layer";
import type { Area, AreaDirectory } from "@/lib/area";
import { DAM_URL, DAM_ZONE_URL, type DamData, type DamZoneData } from "@/lib/dam";
import { REPORTS_NEAR_URL, type ReportsNear } from "@/lib/flood-reports";
import type { Hazard } from "@/lib/hazards";
import type { MapData } from "@/lib/map-data";
import { useOnPhone, useStored } from "@/lib/phone-store";
import { satelliteUrl, type SatelliteFlood, type SatelliteWindow } from "@/lib/satellite-flood";
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
  /*
   * "?dam=bang_lang" from the home screen's button: the map opens with that dam's whole report
   * and travels to it. Read here rather than on the server so the page stays prerendered and is
   * still served from the cache when the phone is offline (safety rule 7); the page wraps this
   * component in a Suspense boundary, which is what keeps that true.
   */
  const query = useSearchParams();
  const openDam = query.get("dam");
  /*
   * "?reports=950101&at=6.54,101.28" from the home screen's "flood reported near you": the map
   * opens on the current situation, on that tambon. The point is the tambon's own, never a
   * report's (safety rule 6).
   */
  const at = (query.get("at") ?? "").split(",").map(Number);
  const reportsTambon = query.get("reports");
  const openReports =
    reportsTambon && /^\d{6}$/.test(reportsTambon) && at.length === 2 && at.every(Number.isFinite)
      ? { tambon: reportsTambon, lat: at[0]!, lon: at[1]! }
      : null;
  const reports = useFetched<ReportsNear>(REPORTS_NEAR_URL);
  const { status, checkedAt, failed } = usePublicStatus();
  const hazards = useFetched<{ hazards: Hazard[] }>("/api/public/hazards");
  const directory = useFetched<AreaDirectory>("/api/geo/areas");
  const data = useFetched<MapData>("/api/public/map");
  // The dam, the reservoir and the path released water takes: public, edge-cached, and asked
  // for in every view because the river is always drawn (spec section 15).
  const dam = useFetched<DamData>(DAM_URL);
  // The zone's outlines are heavy, so they come in their own request and only here, on the map.
  const damZone = useFetched<DamZoneData>(DAM_ZONE_URL);
  const damsWithZones = useMemo(() => {
    const dams = dam.data?.dams ?? null;
    const zones = damZone.data?.zones ?? [];
    if (!dams || zones.length === 0) return dams;
    return dams.map((d) => ({ ...d, zones: zones.filter((z) => z.dam === d.code) }));
  }, [dam.data, damZone.data]);
  // The flood-hazard classes: the tile bucket's manifest names the current file (lib/hazard-layer.ts).
  const tiles = tilesBase();
  const manifest = useFetched<TileManifest>(tiles ? `${tiles}/manifest.json` : null);
  // Flood seen by satellite (GISTDA): asked for only once someone switches it on, and again
  // when they change how far back to look (lib/satellite-flood.ts).
  const [satelliteDays, setSatelliteDays] = useState<SatelliteWindow | null>(null);
  const satellite = useFetched<SatelliteFlood>(satelliteDays ? satelliteUrl(satelliteDays) : null);
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
      dams={damsWithZones}
      hazardTiles={hazardSourceUrl(tiles, manifest.data)}
      satelliteDays={satelliteDays}
      onSatelliteDays={setSatelliteDays}
      satellite={satellite.data}
      satelliteLoad={satellite.state}
      me={me}
      area={area}
      now={now}
      transparency={transparency}
      openDam={openDam}
      openReports={openReports}
      reports={reports.data?.tambons ?? null}
      userAgent={ready ? navigator.userAgent : ""}
    />
  );
}
