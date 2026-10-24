import { EXAMPLE_AUTHORITY_BOARD } from "@/lib/authority-examples";
import type { AuthorityBoard } from "@/lib/dispatch";
import type { MyWork } from "@/lib/field-crew";
import type { UnitRequest } from "@/lib/journey";
import type { OwnedTeam } from "@/lib/unit-team";

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
  "crew",
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
    units: base.units.map((u) => ({ ...u, name, capabilities: ["supplies"] })),
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

/** A rescue-only team's board: its record speaks of rescues, as the real one does for such a team. */
export function exampleRescueBoard(base: AuthorityBoard = EXAMPLE_AUTHORITY_BOARD): AuthorityBoard {
  return { ...base, units: base.units.map((u) => ({ ...u, capabilities: ["rescue"] })) };
}

/** What a crew member sees on their own phone (24 Oct 2026): one case handed to them, one open. */
export function exampleCrewWork(now: number): MyWork {
  return {
    readAt: new Date(now).toISOString(),
    cases: [
      {
        sosId: "00000000-0000-4000-8000-0000000000c1",
        assignmentId: "00000000-0000-4000-8000-0000000000d1",
        status: "assigned",
        kind: "rescue",
        lat: 6.8782,
        lon: 101.2719,
        accuracyM: 12,
        locationText: "ใกล้ศาลาประชาคม หมู่ 3",
        tambonTh: "บานา",
        tambonEn: "Bana",
        peopleCount: 3,
        vulnerableFlags: { elderly: true, bedridden: true },
        depthRef: "waist",
        injuries: null,
        textNote: "น้ำขึ้นเร็ว แม่เดินไม่ได้ อยู่ชั้นสอง",
        needs: [],
        needsNote: null,
        unitName: "ทีมกู้ภัยตัวอย่าง บานา",
        assignedAt: new Date(now - 5 * 60_000).toISOString(),
        hasPhone: true,
        crewCount: 2,
      },
    ],
    open: [
      {
        sosId: "00000000-0000-4000-8000-0000000000c2",
        unitName: "ทีมกู้ภัยตัวอย่าง บานา",
        kind: "supplies",
        status: "assigned",
        tambonTh: "ปะนาเระ",
        tambonEn: "Panare",
        peopleCount: 5,
        crewCount: 0,
      },
    ],
  };
}

/** The owner's team page with a person waiting, a dispatcher and a crew member (24 Oct 2026). */
export function exampleTeam(now: number): OwnedTeam[] {
  return [
    {
      unitId: "00000000-0000-4000-8000-0000000000e1",
      unitName: "ทีมกู้ภัยตัวอย่าง บานา",
      orgName: "มูลนิธิตัวอย่าง",
      members: [
        {
          id: "m1",
          name: "สมชาย (เจ้าของทีม)",
          role: "owner",
          status: "active",
          joinedAt: new Date(now - 30 * 86_400_000).toISOString(),
          isMe: true,
        },
        {
          id: "m2",
          name: "นภา (ผู้ประสานงาน)",
          role: "dispatcher",
          status: "active",
          joinedAt: new Date(now - 6 * 86_400_000).toISOString(),
          isMe: false,
        },
        {
          id: "m3",
          name: "วิชัย (เรือ 1)",
          role: "field",
          status: "active",
          joinedAt: new Date(now - 3 * 86_400_000).toISOString(),
          isMe: false,
        },
        {
          id: "m4",
          name: "มานะ (เรือ 2)",
          role: "field",
          status: "pending",
          joinedAt: new Date(now - 20 * 60_000).toISOString(),
          isMe: false,
        },
      ],
      invites: [
        {
          id: "i1",
          role: "field",
          createdAt: new Date(now - 2 * 3_600_000).toISOString(),
          expiresAt: new Date(now + 22 * 3_600_000).toISOString(),
        },
      ],
    },
  ];
}
