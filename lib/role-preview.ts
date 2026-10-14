import { EXAMPLE_AUTHORITY_BOARD } from "@/lib/authority-examples";
import type { AuthorityBoard } from "@/lib/dispatch";
import type { UnitRequest } from "@/lib/journey";

/**
 * "View as another role" (the owner, 14 Oct): an admin sees each role's own screens, filled with
 * made-up data, to judge the experience. Nothing on these pages reads anyone's data or sends
 * anything: they are the example screens of the /dev pages, reachable on the live site because
 * only an admin can open them (the admin layout turns everyone else away).
 */
export const PREVIEW_ROLES = [
  "visitor",
  "resident",
  "rescue",
  "supplies",
  "pending",
  "operator",
] as const;
export type PreviewRole = (typeof PREVIEW_ROLES)[number];

export function isPreviewRole(value: unknown): value is PreviewRole {
  return (PREVIEW_ROLES as readonly unknown[]).includes(value);
}

/** The resident's home in the states that matter most. */
export const RESIDENT_SCENARIOS = ["watched", "normal", "warning", "evacuate"] as const;
export type ResidentScenario = (typeof RESIDENT_SCENARIOS)[number];

export function residentScenario(value: unknown): ResidentScenario {
  return (RESIDENT_SCENARIOS as readonly unknown[]).includes(value)
    ? (value as ResidentScenario)
    : "watched";
}

/**
 * A food-and-water team's board: the same made-up cases, but only requests for supplies, and
 * the team named for what it does. A rescue request is never offered to such a team.
 */
export function exampleSupplyBoard(base: AuthorityBoard = EXAMPLE_AUTHORITY_BOARD): AuthorityBoard {
  const name = "ทีมส่งอาหารและน้ำตัวอย่าง บานา";
  return {
    ...base,
    units: base.units.map((u) => ({ ...u, name })),
    cases: base.cases
      .filter((c) => c.kind === "supplies")
      .map((c) => (c.offeredIsMine ? { ...c, offeredToName: name } : c)),
  };
}

/** A team that has registered and waits for an admin to call its official number. */
export function examplePendingUnit(now: number): UnitRequest {
  return {
    id: "00000000-0000-4000-8000-0000000000a1",
    name: "ทีมกู้ภัยตัวอย่าง (รอตรวจสอบ)",
    status: "pending",
    createdAt: new Date(now - 26 * 3_600_000).toISOString(),
    verifiedAt: null,
    updatedAt: null,
  };
}

/** The moment the preview is drawn, read outside the page so the page itself stays pure. */
export function previewNow(): number {
  return Date.now();
}
