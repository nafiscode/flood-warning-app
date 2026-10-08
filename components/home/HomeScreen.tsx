"use client";

import type { Area } from "@/lib/area";
import { useOnPhone, useStored, writeStored } from "@/lib/phone-store";
import { useMyPlaces, useNearbyPlaces, useNow, usePublicStatus } from "@/lib/use-public";
import { HomeView } from "./HomeView";

/**
 * The live home screen. The page itself is the same static HTML for everyone (so it can be
 * cached and opens fast on slow 3G); what is personal is put together here on the phone: the
 * chosen area from the phone's storage, the public alert status from the 60 s cache, and, for a
 * signed-in person, their home and watched places.
 */
export function HomeScreen({ projectLine }: { projectLine: string | null }) {
  const ready = useOnPhone();
  const area = useStored<Area>("area");
  const { status, checkedAt, failed, refresh } = usePublicStatus();
  const me = useMyPlaces();
  const now = useNow();
  const home = me?.signedIn && me.home ? me.home : area;
  const nearby = useNearbyPlaces(home ? { lat: home.lat, lon: home.lon } : null);
  return (
    <HomeView
      ready={ready}
      status={status}
      checkedAt={checkedAt}
      failed={failed}
      area={area}
      me={me}
      places={nearby.places}
      placesState={nearby.state}
      now={now}
      onChooseArea={(chosen) => writeStored("area", chosen)}
      onRetry={refresh}
      projectLine={projectLine}
      userAgent={ready ? navigator.userAgent : ""}
    />
  );
}
