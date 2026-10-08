export const SAFE_PLACE_TYPES = [
  "shelter",
  "school",
  "mosque",
  "temple",
  "government",
  "high_ground_parking",
  "other",
] as const;
export type SafePlaceType = (typeof SAFE_PLACE_TYPES)[number];
export type SafePlaceStatus = "open" | "full" | "closed" | "unknown";

/** A safe place as a card shows it (spec 4.3). Public data: these are public buildings. */
export type SafePlace = {
  id: string;
  name: Record<string, string>;
  type: SafePlaceType;
  status: SafePlaceStatus;
  verified: boolean;
  /** Straight-line distance from the person's point; missing on the map, which has no "from". */
  distanceM: number | null;
  lat: number;
  lon: number;
  freeboardM: number | null;
  flooded2024: boolean | null;
  flooded2025: boolean | null;
  capacity: number | null;
  needs: string | null;
  updatedAt: string | null;
};

export type NearbyPlaces = { people: SafePlace[]; parking: SafePlace[] };

export function toSafePlace(row: Record<string, unknown>): SafePlace {
  const number = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const flag = (v: unknown) => (typeof v === "boolean" ? v : null);
  return {
    id: String(row.id),
    name: (row.name ?? {}) as Record<string, string>,
    type: row.type as SafePlaceType,
    status: (row.status ?? "unknown") as SafePlaceStatus,
    verified: row.verification_status === "verified",
    distanceM: number(row.distance_m),
    lat: Number(row.lat),
    lon: Number(row.lon),
    freeboardM: number(row.freeboard_m),
    flooded2024: flag(row.flooded_2024),
    flooded2025: flag(row.flooded_2025),
    capacity: number(row.capacity),
    needs: typeof row.needs === "string" && row.needs !== "" ? row.needs : null,
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : null,
  };
}

/** A name in the reader's language, falling back to Thai, then to anything there is. */
export function localName(name: Record<string, string>, locale: string): string {
  return name[locale] ?? name.th ?? name.en ?? Object.values(name)[0] ?? "";
}

/**
 * A rough travel time from a straight-line distance: roads are taken as 1.4 times longer, on
 * foot at 4 km/h up to 2 km, otherwise by vehicle at 30 km/h. Always shown as "about".
 */
export function roughTravel(distanceM: number): { by: "walk" | "drive"; minutes: number } {
  const roadKm = (distanceM * 1.4) / 1000;
  if (distanceM <= 2000) return { by: "walk", minutes: Math.max(1, Math.round((roadKm / 4) * 60)) };
  return { by: "drive", minutes: Math.max(1, Math.round((roadKm / 30) * 60)) };
}

/**
 * A link that opens directions in the phone's maps app (spec 4.3: free, no routing API).
 * iPhones open Apple Maps; everything else opens Google Maps, or its web page without the app.
 */
export function navigateHref(lat: number, lon: number, userAgent = ""): string {
  const to = `${lat.toFixed(6)},${lon.toFixed(6)}`;
  return /iPhone|iPad|iPod/i.test(userAgent)
    ? `https://maps.apple.com/?daddr=${to}`
    : `https://www.google.com/maps/dir/?api=1&destination=${to}`;
}
