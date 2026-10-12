"use client";

import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { useState } from "react";
import type { ConsoleView } from "@/components/authority/BoardView";
import { CaseCard, type CaseActions } from "@/components/authority/CaseCard";
import { HouseholdsView, ReportsView } from "@/components/authority/TeamReads";
import { CaseMapView, CoverageView, PointsView } from "@/components/authority/Views";
import type {
  CoverageRow,
  CoverageUnit,
  PointsRow,
  TeamHousehold,
  TeamReport,
} from "@/lib/coverage";
import type { BoardCase, CaseMedia } from "@/lib/dispatch";

// MapLibre is loaded only when a map view is opened, never with the case list: the list is what
// a team needs first, and on a slow connection it must not wait for a map.
const BoardMap = dynamic(() => import("@/components/authority/BoardMap").then((m) => m.BoardMap), {
  ssr: false,
});

type Loaded<T> = T | "failed" | null;

type Props = {
  view: Exclude<ConsoleView, "cases">;
  cases: BoardCase[];
  now: number;
  busy: string | null;
  phones: Record<string, string | null>;
  media: Record<string, CaseMedia | "failed">;
  actions: CaseActions;
  coverage: Loaded<CoverageRow[]>;
  points: Loaded<PointsRow[]>;
  picked: { tambon: string; units: Loaded<CoverageUnit[]> } | null;
  onPickTambon: (tambon: string) => void;
  /** The flood reports and the households, with what was asked for one at a time. */
  reads: TeamReadsState;
};

export type TeamReadsState = {
  reports: Loaded<TeamReport[]>;
  households: Loaded<TeamHousehold[]>;
  reportMedia: Record<string, CaseMedia | "failed">;
  householdPhones: Record<string, string | null>;
  onReportMedia: (reportId: string) => void;
  onHouseholdPhone: (householdId: string) => void;
};

/**
 * Whatever the console shows instead of the case list: the cases on a map, the responsibility
 * map, or the points. It holds only which case was tapped on the map; everything else is handed
 * in, so the live console and the example page draw the same thing.
 */
export function OtherView({
  view,
  cases,
  now,
  busy,
  phones,
  media,
  actions,
  coverage,
  points,
  picked,
  onPickTambon,
  reads,
}: Props) {
  const t = useTranslations("authority");
  const [caseId, setCaseId] = useState<string | null>(null);
  if (view === "points") return <PointsView points={points} />;
  if (view === "reports") {
    return (
      <ReportsView
        reports={reads.reports}
        media={reads.reportMedia}
        onMedia={reads.onReportMedia}
      />
    );
  }
  if (view === "households") {
    return (
      <HouseholdsView
        households={reads.households}
        phones={reads.householdPhones}
        onPhone={reads.onHouseholdPhone}
      />
    );
  }

  const map = (
    <BoardMap
      cases={cases}
      coverage={Array.isArray(coverage) ? coverage : null}
      mode={view === "map" ? "cases" : "coverage"}
      picked={picked?.tambon ?? null}
      onPickCase={setCaseId}
      onPickTambon={onPickTambon}
      text={{ loading: t("map.loading"), failed: t("map.failed") }}
    />
  );
  if (view === "coverage") {
    return <CoverageView map={map} coverage={coverage} picked={picked} onPick={onPickTambon} />;
  }
  const chosen = caseId ? (cases.find((c) => c.sosId === caseId) ?? null) : null;
  return (
    <CaseMapView
      map={map}
      picked={
        chosen && (
          <CaseCard
            c={chosen}
            now={now}
            busy={busy === chosen.sosId}
            phone={chosen.sosId in phones ? { number: phones[chosen.sosId] ?? null } : null}
            media={media[chosen.sosId] ?? null}
            actions={actions}
          />
        )
      }
    />
  );
}
