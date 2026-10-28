/** A row of the hazards table as the map's switcher uses it (spec section 13). */
export type Hazard = {
  code: string;
  status: "active" | "coming_soon";
  name: Record<string, string>;
  description: Record<string, string>;
  /** Shown on a coming-soon card; never implies "no risk" (safety rule 10). */
  placeholder: Record<string, string>;
  hotline: string;
};

export type MapMode = "risk" | "live";
export const MAP_LAYERS = [
  "alerts",
  "hazard",
  "river",
  "tambon",
  "places",
  "reports",
  "gauges",
] as const;
export type MapLayer = (typeof MAP_LAYERS)[number];

/**
 * The layers a hazard may draw in a view. A hazard that is not active draws nothing at all: no
 * empty layer and no "all clear" color (safety rule 10).
 * Risk view: hazard map, the river gauges (live, on top of the hazard colours: the owner, 14 Oct)
 * and safe places. Live view: alerts, reports, gauges, and the
 * safe places people are heading to.
 * The river body ("river") is not here: it is a context layer on its own chip, on by default and
 * the same in either view (the owner, 29 Oct), so the caller adds it when its switch is on. The
 * sub-district outlines ("tambon") are likewise added by the caller: off by default in the risk
 * view, on by default in the live view, so the default follows the mode rather than sitting here.
 */
export function layersFor(hazard: Pick<Hazard, "status"> | null, mode: MapMode): MapLayer[] {
  if (!hazard || hazard.status !== "active") return [];
  return mode === "risk"
    ? ["hazard", "gauges", "places"]
    : ["alerts", "reports", "gauges", "places"];
}
