import type { AbstractIntlMessages } from "next-intl";
import type { Journey } from "@/lib/journey";
import { VULNERABLE, type Vulnerable } from "@/lib/sos";

/**
 * A rescue a team found by itself (the owner, 13-14 Oct): the shapes the screens use and the
 * checks a form can make before it asks the server. The database decides everything again -
 * whether it counts at once or waits for an admin, and what it is worth.
 */

export const FIELD_STATUSES = ["counted", "pending", "approved", "rejected"] as const;
export type FieldStatus = (typeof FIELD_STATUSES)[number];

/** Why a record waits for an admin. The words are in `fieldRescue.holds`. */
export const FIELD_HOLDS = [
  "no_flood_evidence",
  "outside_coverage",
  "vague_position",
  "repeat_nearby",
  "many_today",
  "phone_used_before",
  "open_request_here",
  "sent_later",
] as const;
export type FieldHold = (typeof FIELD_HOLDS)[number];

export const FIELD_EVIDENCE = [
  "alert_in_force",
  "flood_report_near",
  "sos_near",
  "flood_prone_area",
] as const;
export type FieldEvidence = (typeof FIELD_EVIDENCE)[number];

export type MyFieldRescue = {
  id: string;
  createdAt: string;
  status: FieldStatus;
  tambonTh: string;
  tambonEn: string;
  people: number;
  holds: FieldHold[];
  points: number;
  reviewedAt: string | null;
  reviewNote: string | null;
};

type Row = Record<string, unknown>;
const known = <T extends string>(list: readonly T[], values: unknown): T[] =>
  Array.isArray(values) ? list.filter((v) => values.includes(v)) : [];

export function toMyFieldRescue(r: Row): MyFieldRescue | null {
  const status = FIELD_STATUSES.find((s) => s === r.status);
  if (typeof r.rescue_id !== "string" || typeof r.created_at !== "string" || !status) return null;
  return {
    id: r.rescue_id,
    createdAt: r.created_at,
    status,
    tambonTh: String(r.tambon_th ?? ""),
    tambonEn: String(r.tambon_en ?? ""),
    people: Math.trunc(Number(r.people_count ?? 0)),
    holds: known(FIELD_HOLDS, r.holds),
    points: Math.trunc(Number(r.points ?? 0)),
    reviewedAt: typeof r.reviewed_at === "string" ? r.reviewed_at : null,
    reviewNote: typeof r.review_note === "string" && r.review_note ? r.review_note : null,
  };
}

/** What recording one answered. */
export type FieldResult = {
  status: FieldStatus;
  holds: FieldHold[];
  evidence: FieldEvidence[];
  points: number;
};

export function toFieldResult(r: Row | null | undefined): FieldResult | null {
  const status = FIELD_STATUSES.find((s) => s === r?.status);
  if (!r || !status) return null;
  return {
    status,
    holds: known(FIELD_HOLDS, r.holds),
    evidence: known(FIELD_EVIDENCE, r.evidence),
    points: Math.trunc(Number(r.points ?? 0)),
  };
}

/**
 * Recorded, then either counted at once, or checked by an admin and approved or refused. The
 * same line of steps every other request has (lib/journey.ts).
 */
export function fieldJourney(r: MyFieldRescue): Journey {
  const recorded = { key: "recorded", state: "done" as const, at: r.createdAt };
  if (r.status === "counted") {
    return {
      kind: "field",
      open: false,
      steps: [recorded, { key: "counted", state: "done", at: r.createdAt }],
    };
  }
  if (r.status === "pending") {
    return {
      kind: "field",
      open: true,
      steps: [
        recorded,
        { key: "review", state: "now", at: null },
        { key: "approved", state: "todo", at: null },
      ],
    };
  }
  return {
    kind: "field",
    open: false,
    steps: [
      recorded,
      { key: "review", state: "done", at: null },
      r.status === "approved"
        ? { key: "approved", state: "done", at: r.reviewedAt }
        : { key: "rejected", state: "stopped", at: r.reviewedAt },
    ],
  };
}

/** Bell news for the team: only what an admin decided. */
export function fieldNews(
  r: MyFieldRescue,
): { id: string; event: "approved" | "rejected"; at: string } | null {
  if ((r.status !== "approved" && r.status !== "rejected") || !r.reviewedAt) return null;
  return { id: `field:${r.id}:${r.status}`, event: r.status, at: r.reviewedAt };
}

/** Digits only, as the database keeps it; null when it cannot be a phone number. */
export function cleanPhone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const digits = value.replace(/[^0-9+]/g, "");
  return /^\+?[0-9]{8,15}$/.test(digits) ? digits : null;
}

export type FieldForm = {
  people: number;
  vulnerable: Vulnerable[];
  phone: string;
  note: string;
};

export type FieldFormError = "position" | "phone" | "people" | "photo";

/**
 * What must be there before the form may be sent: the position, the phone number, how many
 * people, and a photo (the owner: all required). The first thing missing, in the order the form
 * shows them, or null.
 */
export function checkFieldForm(input: {
  located: boolean;
  phone: string;
  people: number;
  photos: number;
}): FieldFormError | null {
  if (!input.located) return "position";
  if (!Number.isInteger(input.people) || input.people < 1 || input.people > 200) return "people";
  if (!cleanPhone(input.phone)) return "phone";
  if (input.photos < 1) return "photo";
  return null;
}

export const vulnerableFlags = (chosen: readonly Vulnerable[]): Record<string, boolean> =>
  Object.fromEntries(VULNERABLE.filter((v) => chosen.includes(v)).map((v) => [v, true]));

export const FIELD_URL = "/api/authority/field-rescue";
export const FIELD_BUCKET = "field-media";

/** The words the recording screen needs in the browser. */
export function fieldRescueMessages(messages: AbstractIntlMessages): AbstractIntlMessages {
  const all = messages as Record<string, Record<string, AbstractIntlMessages>>;
  return {
    fieldRescue: all.fieldRescue as AbstractIntlMessages,
    journey: all.journey as AbstractIntlMessages,
    sos: { vulnerable: all.sos!.vulnerable! },
  };
}
