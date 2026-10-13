"use client";

import type { Area } from "@/lib/area";
import { useOnPhone, useStored, writeStored } from "@/lib/phone-store";
import { DAM_URL, type DamData } from "@/lib/dam";
import {
  useFetched,
  useMyPlaces,
  useNearbyPlaces,
  useNow,
  usePublicStatus,
} from "@/lib/use-public";
import { InstallCard } from "@/components/InstallCard";
import { ShareApp } from "@/components/ShareApp";
import { RequestsLink } from "@/components/journey/MyRequests";
import { PushCard } from "@/components/push/PushCard";
import { MyReports } from "@/components/reports/MyReports";
import { REPORTS_NEAR_URL, type ReportsNear } from "@/lib/flood-reports";
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
  /*
   * The dam, for the quiet notice (spec section 15). Asked for on the home screen because
   * this is the screen a person actually opens: a notice only on the map would reach the
   * people who already went looking. The answer is the same edge-cached one the map reads.
   */
  const dam = useFetched<DamData>(DAM_URL);
  // What residents have reported, per tambon: the same edge-cached answer for everyone; this
  // phone picks out its own district itself (the owner, 13 Oct).
  const reports = useFetched<ReportsNear>(REPORTS_NEAR_URL);
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
      dams={dam.data?.dams ?? null}
      reports={reports.data?.tambons ?? null}
      myReports={
        <>
          <RequestsLink />
          <MyReports />
        </>
      }
      projectLine={projectLine}
      userAgent={ready ? navigator.userAgent : ""}
      push={<PushCard place="home" />}
      install={
        <>
          <InstallCard place="home" />
          <ShareApp />
        </>
      }
    />
  );
}
