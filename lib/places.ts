import {
  CHECK_SOURCES,
  toResidentsSaid,
  type CheckSource,
  type ResidentsSaid,
} from "@/lib/place-checks";

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
  /** When somebody was last at the place and said what it was like (lib/place-checks.ts). */
  checkedAt: string | null;
  checkedSource: CheckSource | null;
  /** When that check goes stale, from the level in force where the place is. */
  checkDueAt: string | null;
  /** What residents have said lately: counts of people only. Never the card's status. */
  residentsSaid: ResidentsSaid | null;
};

export type NearbyPlaces = { people: SafePlace[]; parking: SafePlace[] };

export function toSafePlace(row: Record<string, unknown>): SafePlace {
  const number = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const flag = (v: unknown) => (typeof v === "boolean" ? v : null);
  const text = (v: unknown) => (typeof v === "string" && v !== "" ? v : null);
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
    checkedAt: text(row.checked_at),
    checkedSource: CHECK_SOURCES.find((s) => s === row.checked_source) ?? null,
    checkDueAt: text(row.check_due_at),
    residentsSaid: toResidentsSaid(row.residents_said),
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

export type NavigateApp = "google" | "waze" | "apple" | "other";

/**
 * The apps offered for directions to a point (spec 4.3: free, no routing API), in the order
 * they are shown. The person chooses; nothing opens by itself (owner, 13 Oct).
 *
 * A web page cannot ask a phone which apps it has. So Google Maps and Waze are always offered:
 * their links open the app where it is installed and the app's web page where it is not. Apple
 * Maps is offered on Apple devices only. On Android a `geo:` link hands the point to the system,
 * which shows its own list of every installed app that can navigate; iOS has no such link.
 */
export function navigateChoices(
  lat: number,
  lon: number,
  userAgent = "",
): { app: NavigateApp; href: string }[] {
  const to = `${lat.toFixed(6)},${lon.toFixed(6)}`;
  const choices: { app: NavigateApp; href: string }[] = [
    { app: "google", href: `https://www.google.com/maps/dir/?api=1&destination=${to}` },
    { app: "waze", href: `https://waze.com/ul?ll=${to}&navigate=yes` },
  ];
  if (/iPhone|iPad|iPod|Macintosh/i.test(userAgent))
    choices.push({ app: "apple", href: `https://maps.apple.com/?daddr=${to}` });
  if (/Android/i.test(userAgent)) choices.push({ app: "other", href: `geo:${to}?q=${to}` });
  return choices;
}
