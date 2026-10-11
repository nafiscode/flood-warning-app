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
};

export const EXAMPLE_AUTHORITY_BOARD: AuthorityBoard = {
  readAt: new Date(EXAMPLE_NOW).toISOString(),
  units: [
    {
      id: MY_UNIT,
      name: "ทีมกู้ภัยตัวอย่าง บานา",
      orgName: "มูลนิธิตัวอย่าง",
      onDuty: true,
      sharesPocPhone: true,
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
    },
  ],
};

export type ExampleTap =
  | { action: "accept"; sos: string }
  | { action: "decline"; sos: string; reason: DeclineReason }
  | { action: "eta"; sos: string; band: EtaBand }
  | { action: "advance"; sos: string; status: "en_route" | "on_site" }
  | { action: "release"; sos: string; reason: ReleaseReason }
  | { action: "duty"; unit: string; on: boolean }
  | { action: "sharing"; unit: string; on: boolean };

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
