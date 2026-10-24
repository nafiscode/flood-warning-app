/**
 * Made-up data for /dev/authority, the review page for the authority console (same rule as
 * lib/dev-examples.ts: nothing here is in the database and the page is not available in
 * production). The tambons are real so the screen reads naturally; every case, team and detail
 * is invented, and there is no phone number in here: the board never carries one.
 *
 * The example answers taps by itself (applyExample), so accepting, giving an estimate and handing
 * a case back can all be tried without a database behind them.
 */
import type {
  CoverageRow,
  CoverageUnit,
  PointsRow,
  TeamHousehold,
  TeamReport,
} from "@/lib/coverage";
import type {
  AuthorityBoard,
  BoardCase,
  DeclineReason,
  EtaBand,
  ReleaseReason,
} from "@/lib/dispatch";

/** The example is seen at 16:30 Bangkok time on 20 November 2026, like the other /dev pages. */
export const EXAMPLE_NOW = Date.parse("2026-11-20T09:30:00Z");
const at = (minutes: number) => new Date(EXAMPLE_NOW + minutes * 60_000).toISOString();

const MY_UNIT = "00000000-0000-4000-8000-0000000000a1";
const OTHER_UNIT = "00000000-0000-4000-8000-0000000000b2";

const blank: BoardCase = {
  sosId: "",
  createdAt: at(0),
  status: "received",
  hazard: "unknown",
  lat: 6.8676,
  lon: 101.2501,
  accuracyM: null,
  locationText: null,
  tambon: "940104",
  tambonNameTh: "บานา",
  tambonNameEn: "Bana",
  peopleCount: null,
  vulnerableFlags: {},
  depthRef: null,
  injuries: null,
  note: null,
  photos: [],
  voiceUrl: null,
  priorityScore: 0,
  hasPhone: false,
  suspectedSpam: false,
  waitingMinutes: 0,
  claimedBy: null,
  claimedByName: null,
  claimedIsMine: false,
  etaBand: null,
  etaGivenAt: null,
  offeredTo: null,
  offeredToName: null,
  offeredIsMine: false,
  offerExpiresAt: null,
  offerExhausted: false,
  myResponse: null,
  closedAt: null,
  completedAt: null,
  proofCount: 0,
  kind: "rescue",
  needs: [],
  needsNote: null,
  suppliesLeft: null,
  canConfirm: false,
};

export const EXAMPLE_AUTHORITY_BOARD: AuthorityBoard = {
  readAt: new Date(EXAMPLE_NOW).toISOString(),
  crew: [
    { unitId: MY_UNIT, userId: "u-owner", name: "สมชาย (เจ้าของทีม)", role: "owner", openCases: 0 },
    { unitId: MY_UNIT, userId: "u-boat1", name: "วิชัย (เรือ 1)", role: "field", openCases: 1 },
    { unitId: MY_UNIT, userId: "u-boat2", name: "มานะ (เรือ 2)", role: "field", openCases: 0 },
  ],
  assignments: [],
  units: [
    {
      id: MY_UNIT,
      name: "ทีมกู้ภัยตัวอย่าง บานา",
      orgName: "มูลนิธิตัวอย่าง",
      onDuty: true,
      sharesPocPhone: true,
      isOwner: true,
      capabilities: ["rescue", "supplies"],
    },
  ],
  cases: [
    {
      ...blank,
      sosId: "11111111-0000-4000-8000-000000000001",
      createdAt: at(-2),
      waitingMinutes: 2,
      hazard: "flood",
      accuracyM: 12,
      peopleCount: 4,
      vulnerableFlags: { elderly: true, bedridden: true },
      depthRef: "waist",
      note: "น้ำขึ้นเร็ว แม่เดินไม่ได้ อยู่ชั้นสอง",
      priorityScore: 9,
      hasPhone: true,
      offeredTo: MY_UNIT,
      offeredToName: "ทีมกู้ภัยตัวอย่าง บานา",
      offeredIsMine: true,
      offerExpiresAt: at(0.7),
    },
    {
      ...blank,
      sosId: "22222222-0000-4000-8000-000000000002",
      createdAt: at(-38),
      waitingMinutes: 38,
      tambon: "940111",
      tambonNameTh: "ปูยุด",
      tambonNameEn: "Puyut",
      lat: 6.8421,
      lon: 101.2894,
      peopleCount: 2,
      depthRef: "knee",
      priorityScore: 4,
      offerExhausted: true,
      myResponse: "timed_out",
    },
    // Someone safe upstairs and out of drinking water: offered to this team, never ringing.
    {
      ...blank,
      sosId: "88888888-0000-4000-8000-000000000008",
      createdAt: at(-14),
      waitingMinutes: 14,
      lat: 6.8655,
      lon: 101.2533,
      peopleCount: 5,
      priorityScore: 6,
      hasPhone: true,
      kind: "supplies",
      needs: ["water", "food", "baby"],
      needsNote: "บ้านสองชั้นหลังมัสยิด เด็กอายุ 8 เดือน ต้องการนมผง",
      suppliesLeft: "none",
      offeredTo: MY_UNIT,
      offeredToName: "ทีมกู้ภัยตัวอย่าง บานา",
      offeredIsMine: true,
      offerExpiresAt: at(6),
    },
    {
      ...blank,
      sosId: "33333333-0000-4000-8000-000000000003",
      createdAt: at(-6),
      waitingMinutes: 6,
      lat: 6.8712,
      lon: 101.2466,
      peopleCount: 1,
      vulnerableFlags: { needs_medicine: true },
      depthRef: "ankle",
      priorityScore: 5,
      hasPhone: true,
      offeredTo: OTHER_UNIT,
      offeredToName: "อปพร. ตัวอย่าง",
      offerExpiresAt: at(0.4),
      myResponse: "declined",
      suspectedSpam: true,
    },
    {
      ...blank,
      sosId: "44444444-0000-4000-8000-000000000004",
      createdAt: at(-52),
      waitingMinutes: 52,
      status: "en_route",
      tambon: "940111",
      tambonNameTh: "ปูยุด",
      tambonNameEn: "Puyut",
      lat: 6.8388,
      lon: 101.2931,
      accuracyM: 25,
      peopleCount: 6,
      vulnerableFlags: { infant_child: true, pregnant: true },
      depthRef: "chest",
      injuries: "เท้าโดนของมีคมบาด",
      priorityScore: 11,
      hasPhone: true,
      claimedBy: MY_UNIT,
      claimedByName: "ทีมกู้ภัยตัวอย่าง บานา",
      claimedIsMine: true,
      etaBand: "to30",
      etaGivenAt: at(-20),
      myResponse: "accepted",
    },
    {
      ...blank,
      sosId: "55555555-0000-4000-8000-000000000005",
      createdAt: at(-75),
      waitingMinutes: 75,
      status: "assigned",
      lat: 6.8609,
      lon: 101.2533,
      peopleCount: 3,
      depthRef: "knee",
      priorityScore: 3,
      claimedBy: OTHER_UNIT,
      claimedByName: "อปพร. ตัวอย่าง",
      etaBand: "over60",
      etaGivenAt: at(-40),
    },
    {
      ...blank,
      sosId: "66666666-0000-4000-8000-000000000006",
      createdAt: at(-300),
      waitingMinutes: 300,
      status: "rescued",
      peopleCount: 2,
      depthRef: "waist",
      closedAt: at(-200),
    },
    {
      // Another team reported this rescue 13 hours ago and the person never confirmed it.
      ...blank,
      sosId: "77777777-0000-4000-8000-000000000007",
      createdAt: at(-900),
      waitingMinutes: 900,
      status: "rescued",
      tambon: "940111",
      tambonNameTh: "ปูยุด",
      tambonNameEn: "Puyut",
      lat: 6.8405,
      lon: 101.2877,
      peopleCount: 5,
      vulnerableFlags: { elderly: true },
      depthRef: "waist",
      claimedBy: OTHER_UNIT,
      claimedByName: "อปพร. ตัวอย่าง",
      completedAt: at(-780),
      proofCount: 2,
      canConfirm: true,
    },
  ],
};

/**
 * A made-up slice of the responsibility map: real tambons of Mueang Pattani, invented teams. Two
 * of them have no rescue team, one of those only a coordinator, so the example shows a gap.
 */
const COVER: [string, string, string, number, number, boolean][] = [
  ["940101", "สะบารัง", "Sabarang", 2, 1, false],
  ["940102", "อาเนาะรู", "A Noru", 1, 0, false],
  ["940103", "จะบังติกอ", "Chabang Tiko", 0, 1, false],
  ["940104", "บานา", "Bana", 2, 0, true],
  ["940105", "ตันหยงลุโละ", "Tanyong Lulo", 0, 0, false],
  ["940111", "ปูยุด", "Puyut", 1, 1, true],
];
export const EXAMPLE_COVERAGE: CoverageRow[] = COVER.map(
  ([tambon, nameTh, nameEn, rescueUnits, coordinationUnits, mine]) => ({
    tambon,
    nameTh,
    nameEn,
    province: "94",
    rescueUnits,
    coordinationUnits,
    suppliesUnits: mine ? 1 : 0,
    mine,
  }),
);

/** Who covers a tambon in the example: the caller's own team where it does, and one other. */
export function exampleUnits(tambon: string): CoverageUnit[] {
  const row = EXAMPLE_COVERAGE.find((r) => r.tambon === tambon);
  if (!row) return [];
  const units: CoverageUnit[] = [];
  if (row.mine) {
    units.push({
      id: MY_UNIT,
      name: "ทีมกู้ภัยตัวอย่าง บานา",
      orgName: "มูลนิธิตัวอย่าง",
      capabilities: ["rescue"],
      onDuty: true,
      mine: true,
    });
  }
  if (row.rescueUnits > (row.mine ? 1 : 0)) {
    units.push({
      id: OTHER_UNIT,
      name: "อปพร. ตัวอย่าง",
      orgName: "เทศบาลตัวอย่าง",
      capabilities: ["rescue", "support"],
      onDuty: false,
      mine: false,
    });
  }
  if (row.coordinationUnits > 0) {
    units.push({
      id: "00000000-0000-4000-8000-0000000000c3",
      name: "ศูนย์ประสานงานตัวอย่าง",
      orgName: "อำเภอตัวอย่าง",
      capabilities: ["coordination"],
      onDuty: true,
      mine: false,
    });
  }
  return units;
}

/** Invented points: 10 a confirmed case, 2 a person, 3 more with vulnerable people. */
export const EXAMPLE_POINTS: PointsRow[] = [
  {
    province: "94",
    unitId: OTHER_UNIT,
    unitName: "อปพร. ตัวอย่าง",
    orgName: "เทศบาลตัวอย่าง",
    points: 214,
    cases: 13,
    mine: false,
  },
  {
    province: "94",
    unitId: MY_UNIT,
    unitName: "ทีมกู้ภัยตัวอย่าง บานา",
    orgName: "มูลนิธิตัวอย่าง",
    points: 167,
    cases: 9,
    mine: true,
  },
  {
    province: "95",
    unitId: "00000000-0000-4000-8000-0000000000d4",
    unitName: "ทีมเรือกู้ภัยตัวอย่าง ยะลา",
    orgName: "มูลนิธิตัวอย่าง",
    points: 88,
    cases: 5,
    mine: false,
  },
];

/** Invented flood reports in the team's two tambons. */
export const EXAMPLE_REPORTS: TeamReport[] = [
  {
    id: "aaaaaaaa-0000-4000-8000-000000000001",
    createdAt: at(-25),
    hazard: "flood",
    lat: 6.8691,
    lon: 101.2522,
    tambon: "940104",
    tambonNameTh: "บานา",
    tambonNameEn: "Bana",
    depth: "knee",
    trend: "rising",
    roadAccess: "motorbike_only",
    note: "น้ำข้ามถนนหน้ามัสยิด รถเล็กผ่านไม่ได้",
    photoCount: 2,
    hasVoice: false,
    moderation: "approved",
  },
  {
    id: "aaaaaaaa-0000-4000-8000-000000000002",
    createdAt: at(-140),
    hazard: "flood",
    lat: 6.8402,
    lon: 101.2903,
    tambon: "940111",
    tambonNameTh: "ปูยุด",
    tambonNameEn: "Puyut",
    depth: "waist",
    trend: "steady",
    roadAccess: "impassable",
    note: null,
    photoCount: 0,
    hasVoice: false,
    moderation: "pending",
  },
];

/** Invented households that asked to be known about. No phone number is in here either. */
export const EXAMPLE_HOUSEHOLDS: TeamHousehold[] = [
  {
    id: "bbbbbbbb-0000-4000-8000-000000000001",
    tambon: "940104",
    tambonNameTh: "บานา",
    tambonNameEn: "Bana",
    lat: 6.8684,
    lon: 101.2508,
    size: 5,
    vulnerable: { elderly: 2, bedridden: 1 },
    mobilityNotes: "ยายนอนติดเตียงอยู่ชั้นล่าง ต้องใช้เปลหาม",
    hasPhone: true,
    onBehalf: false,
    updatedAt: at(-60 * 24 * 12),
  },
  {
    id: "bbbbbbbb-0000-4000-8000-000000000002",
    tambon: "940104",
    tambonNameTh: "บานา",
    tambonNameEn: "Bana",
    lat: 6.8701,
    lon: 101.2479,
    size: 3,
    vulnerable: { infant_child: 2 },
    mobilityNotes: null,
    hasPhone: false,
    onBehalf: false,
    updatedAt: at(-60 * 24 * 30),
  },
  {
    id: "bbbbbbbb-0000-4000-8000-000000000003",
    tambon: "940111",
    tambonNameTh: "ปูยุด",
    tambonNameEn: "Puyut",
    lat: 6.8411,
    lon: 101.2889,
    size: 1,
    vulnerable: { elderly: 1, needs_dialysis: 1 },
    mobilityNotes: "อยู่คนเดียว ต้องฟอกไตสัปดาห์ละสามครั้ง",
    hasPhone: true,
    onBehalf: true,
    updatedAt: at(-60 * 24 * 3),
  },
];

export type ExampleTap =
  | { action: "accept"; sos: string }
  | { action: "decline"; sos: string; reason: DeclineReason }
  | { action: "eta"; sos: string; band: EtaBand }
  | { action: "advance"; sos: string; status: "en_route" | "on_site" }
  | { action: "release"; sos: string; reason: ReleaseReason }
  | { action: "complete"; sos: string; photos: number }
  | { action: "confirm"; sos: string }
  | { action: "duty"; unit: string; on: boolean }
  | { action: "sharing"; unit: string; on: boolean }
  | { action: "assign"; sos: string; userId: string }
  | { action: "unassign"; assignmentId: string };

/**
 * What the database would do with a tap, near enough for a review page: accepting makes the case
 * the team's own, declining passes the offer on, giving it back ends with nobody holding it.
 */
export function applyExample(board: AuthorityBoard, tap: ExampleTap, now: number): AuthorityBoard {
  if (tap.action === "duty" || tap.action === "sharing") {
    return {
      ...board,
      units: board.units.map((u) =>
        u.id !== tap.unit
          ? u
          : tap.action === "duty"
            ? { ...u, onDuty: tap.on }
            : { ...u, sharesPocPhone: tap.on },
      ),
    };
  }
  // Handing a case to a person changes the crew lists, not the case.
  if (tap.action === "assign") {
    const who = board.crew.find((m) => m.userId === tap.userId);
    if (!who || board.assignments.some((a) => a.sosId === tap.sos && a.userId === tap.userId)) {
      return board;
    }
    return {
      ...board,
      assignments: [
        ...board.assignments,
        {
          id: `a-${tap.sos}-${tap.userId}`,
          sosId: tap.sos,
          userId: tap.userId,
          name: who.name,
          selfAssigned: false,
          assignedAt: new Date(now).toISOString(),
        },
      ],
    };
  }
  if (tap.action === "unassign") {
    return { ...board, assignments: board.assignments.filter((a) => a.id !== tap.assignmentId) };
  }
  const mine = board.units[0];
  const cases = board.cases.map((c): BoardCase => {
    if (c.sosId !== tap.sos) return c;
    switch (tap.action) {
      case "accept":
        if (c.claimedBy) return c;
        return {
          ...c,
          status: "assigned",
          claimedBy: mine?.id ?? MY_UNIT,
          claimedByName: mine?.name ?? null,
          claimedIsMine: true,
          offeredTo: null,
          offeredToName: null,
          offeredIsMine: false,
          offerExpiresAt: null,
          offerExhausted: false,
          myResponse: "accepted",
        };
      case "decline":
        return {
          ...c,
          offeredTo: OTHER_UNIT,
          offeredToName: "อปพร. ตัวอย่าง",
          offeredIsMine: false,
          offerExpiresAt: new Date(now + 60_000).toISOString(),
          myResponse: "declined",
        };
      case "eta":
        return { ...c, etaBand: tap.band, etaGivenAt: new Date(now).toISOString() };
      case "advance":
        return { ...c, status: tap.status };
      case "complete":
        return {
          ...c,
          status: "rescued",
          completedAt: new Date(now).toISOString(),
          proofCount: tap.photos,
        };
      case "confirm":
        return { ...c, closedAt: new Date(now).toISOString(), canConfirm: false };
      case "release":
        return {
          ...c,
          status: "received",
          claimedBy: null,
          claimedByName: null,
          claimedIsMine: false,
          etaBand: null,
          etaGivenAt: null,
          offerExhausted: true,
          myResponse: null,
        };
    }
  });
  return { ...board, cases };
}
