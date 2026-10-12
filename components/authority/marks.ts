import type { CSSProperties } from "react";
import { caseState, type BoardCase, type CaseState } from "@/lib/dispatch";

/**
 * The colours and legend marks of the team's maps, apart from the map itself so the legend and
 * the words around it can be drawn (and tested) without loading MapLibre. A map layer cannot
 * read a CSS variable, so the three fixed colours live here and the map imports them.
 */
export const SOS_RED = "#c62828";
export const CLOSED_GREY = "#6b7780";
export const TEAL = "#2f9c95";

/** The marks of the case map, in the order the legend lists them. */
export const CASE_MARKS: {
  key: "open" | "mine" | "other" | "awaiting" | "closed";
  style: CSSProperties;
}[] = [
  { key: "open", style: { background: SOS_RED } },
  { key: "mine", style: { background: "var(--jaga-text)" } },
  {
    key: "other",
    style: { background: "transparent", boxShadow: "inset 0 0 0 3px var(--jaga-text)" },
  },
  {
    key: "awaiting",
    style: {
      background: "transparent",
      boxShadow: `inset 0 0 0 3px ${CLOSED_GREY}`,
      transform: "scale(0.8)",
    },
  },
  { key: "closed", style: { background: CLOSED_GREY, transform: "scale(0.6)" } },
];

export const COVER_MARKS: { key: "covered" | "gap" | "mine"; style: CSSProperties }[] = [
  { key: "covered", style: { background: TEAL, opacity: 0.45, borderRadius: 4 } },
  { key: "gap", style: { background: "var(--jaga-text)", opacity: 0.55, borderRadius: 4 } },
  {
    key: "mine",
    style: { background: "transparent", boxShadow: `inset 0 0 0 3px ${TEAL}`, borderRadius: 4 },
  },
];

/** 0 nobody holds it, 1 this team, 2 another team, 3 reported and unconfirmed, 4 finished. */
export const MAP_STATE: Record<CaseState, number> = {
  offered_to_me: 0,
  unanswered: 0,
  searching: 0,
  mine: 1,
  held_by_other: 2,
  awaiting: 3,
  closed: 4,
};

export function caseFeatures(cases: BoardCase[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: cases
      .filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lon))
      .map((c) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [c.lon, c.lat] },
        properties: { id: c.sosId, state: MAP_STATE[caseState(c)] },
      })),
  };
}
