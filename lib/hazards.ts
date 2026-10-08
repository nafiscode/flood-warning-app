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
export const MAP_LAYERS = ["alerts", "hazard", "places", "reports", "gauges"] as const;
export type MapLayer = (typeof MAP_LAYERS)[number];

/**
 * The layers a hazard may draw in a view. A hazard that is not active draws nothing at all: no
 * empty layer and no "all clear" color (safety rule 10).
 * Pre-season risk view: hazard map and safe places. Live view: alerts, reports, gauges, and the
 * safe places people are heading to.
 */
export function layersFor(hazard: Pick<Hazard, "status"> | null, mode: MapMode): MapLayer[] {
  if (!hazard || hazard.status !== "active") return [];
  return mode === "risk" ? ["hazard", "places"] : ["alerts", "reports", "gauges", "places"];
}
