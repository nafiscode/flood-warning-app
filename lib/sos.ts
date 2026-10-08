/**
 * What an SOS looks like between the browser and the server, and what the phone remembers about
 * its own cases. Shared by the pages, the API routes and the tests, so one shape is used
 * everywhere. Nothing here reads the database.
 */
import { readStored, writeStored } from "@/lib/phone-store";

/** What's happening, asked only after sending and never pre-selected (spec 4.6). */
export const HAZARD_CHOICES = [
  "flood",
  "flash_flood",
  "landslide",
  "fire",
  "earthquake",
  "other",
  "unknown",
] as const;
export type HazardChoice = (typeof HAZARD_CHOICES)[number];

export const DEPTHS = ["dry", "ankle", "knee", "waist", "chest", "above_head", "roof"] as const;
export type Depth = (typeof DEPTHS)[number];

export const TRENDS = ["rising", "steady", "falling"] as const;
export const ROAD_ACCESS = ["car", "motorbike_only", "impassable"] as const;

/** The vulnerable people an SOS may mention (spec 4.6). Each one raises the priority score. */
export const VULNERABLE = [
  "elderly",
  "bedridden",
  "infant_child",
  "pregnant",
  "disability",
  "needs_medicine",
  "needs_oxygen",
  "needs_dialysis",
] as const;
export type Vulnerable = (typeof VULNERABLE)[number];

export const SOS_STATUSES = [
  "received",
  "assigned",
  "en_route",
  "rescued",
  "safe_cancelled",
  "dismissed",
] as const;
export type SosStatus = (typeof SOS_STATUSES)[number];

export const OPEN_STATUSES: SosStatus[] = ["received", "assigned", "en_route"];

export type SendSos = {
  lat: number;
  lon: number;
  accuracy?: number | null;
  /** What the person typed when GPS failed and they could not place a pin either. */
  locationText?: string | null;
  deviceId?: string | null;
  phone?: string | null;
  onBehalf?: boolean;
  onBehalfNote?: string | null;
  onSitePhone?: string | null;
  battery?: number | null;
  /** When the SOS was written on the phone, which may be long before it reaches the server. */
  sentAt?: string | null;
};

export type SentSos = {
  id: string;
  /** Only for a new case: the key the phone keeps so it can follow a case without an account. */
  token: string | null;
  merged: boolean;
  status: SosStatus;
  createdAt: string;
};

export type TimelineEntry = {
  event: string;
  at: string;
  note: string | null;
  unit: string | null;
};

export type SosTimeline = {
  status: SosStatus;
  createdAt: string;
  closedAt: string | null;
  hazardType: HazardChoice;
  lat: number | null;
  lon: number | null;
  hasPhone: boolean;
  unitName: string | null;
  orgName: string | null;
  photos: number;
  hasVoice: boolean;
  events: TimelineEntry[];
};

export type SosDetails = {
  hazardType?: HazardChoice | null;
  peopleCount?: number | null;
  vulnerable?: Vulnerable[];
  depth?: Depth | null;
  injuries?: string | null;
  text?: string | null;
  phone?: string | null;
  battery?: number | null;
};

/** The cases this phone has sent, newest first. The token is the only way back to an anonymous case. */
export type RememberedCase = {
  id: string;
  token: string | null;
  status: SosStatus;
  createdAt: string;
  /** Set while the case is still in the offline queue, so the page can say "not sent yet". */
  queueKey?: string | null;
};

const KEY = "sos.cases";
const LIMIT = 10;

export function rememberedCases(): RememberedCase[] {
  const stored = readStored<RememberedCase[]>(KEY);
  return Array.isArray(stored) ? stored : [];
}

export function rememberCase(next: RememberedCase): void {
  const rest = rememberedCases().filter(
    (c) => c.id !== next.id && (!next.queueKey || c.queueKey !== next.queueKey),
  );
  writeStored(KEY, [next, ...rest].slice(0, LIMIT));
}

export function forgetCase(id: string): void {
  writeStored(
    KEY,
    rememberedCases().filter((c) => c.id !== id),
  );
}

export function caseToken(id: string): string | null {
  return rememberedCases().find((c) => c.id === id)?.token ?? null;
}

/** The newest case that may still be open, for the banner on the home screen. */
export function openCase(): RememberedCase | null {
  return rememberedCases().find((c) => OPEN_STATUSES.includes(c.status)) ?? null;
}

/**
 * This browser's own id, so a repeat SOS from the same phone merges into the open case even
 * without an account (spec 4.6). It is a random string, not a fingerprint, and never leaves the
 * phone except with an SOS.
 */
const DEVICE_KEY = "device";

export function deviceId(): string {
  const stored = readStored<string>(DEVICE_KEY);
  if (typeof stored === "string" && stored.length >= 8) return stored;
  const fresh =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `d-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  writeStored(DEVICE_KEY, fresh);
  return fresh;
}
