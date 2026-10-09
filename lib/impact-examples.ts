/**
 * Made-up data for the impact dashboard, exactly as lib/dev-examples.ts and
 * lib/war-room-examples.ts are made up: nothing in here is in the database, nothing was measured,
 * and the page that shows it says so at the top before anything else.
 *
 * It exists because the dashboard was asked for before there is a season to show (owner, 9 Oct).
 * The provinces, districts and tambons are real so the screen reads naturally. Every number is
 * invented, and the organisations carry the word "ตัวอย่าง" (example) in their names: invented
 * rescue counts must never be readable as a claim about a real foundation or a real municipality.
 *
 * The figures are internally consistent on purpose - the units' cases add up to the cases that
 * were accepted, and the outcomes add up to the requests - so that the design can be judged on
 * numbers that behave like real ones. tests/unit/impact.test.tsx keeps them adding up.
 */
import type { ImpactSeason, UnitImpact } from "@/lib/impact";

/** The example season is read on 5 January 2027, looking back at Nov-Dec 2026. */
export const EXAMPLE_COMPUTED_AT = "2027-01-05T01:00:00Z";

const unit = (
  id: string,
  org: string,
  name: string,
  province: UnitImpact["province"],
  capabilities: UnitImpact["capabilities"],
  accepted: number,
  confirmed: number,
  peopleReached: number,
  seasons: number,
  acceptedThisMonth: number,
  confirmedThisMonth: number,
  lastSeasonAccepted: number | null,
): UnitImpact => ({
  id,
  org,
  unit: name,
  province,
  capabilities,
  accepted,
  confirmed,
  peopleReached,
  seasons,
  acceptedThisMonth,
  confirmedThisMonth,
  lastSeasonAccepted,
});

const UNITS: UnitImpact[] = [
  unit(
    "u1",
    "มูลนิธิตัวอย่าง ก.",
    "ชุดเรือท้องแบน เมืองปัตตานี",
    "94",
    ["rescue"],
    64,
    48,
    205,
    3,
    21,
    16,
    51,
  ),
  unit(
    "u2",
    "อบต.ตัวอย่าง ยะหริ่ง",
    "ชุดกู้ภัยยะหริ่ง",
    "94",
    ["rescue", "support"],
    58,
    41,
    176,
    2,
    19,
    13,
    62,
  ),
  unit(
    "u3",
    "มูลนิธิตัวอย่าง ข.",
    "ชุดเรือเร็ว เมืองยะลา",
    "95",
    ["rescue"],
    47,
    33,
    142,
    3,
    15,
    11,
    44,
  ),
  unit("u4", "กู้ภัยอาสาตัวอย่าง ค.", "ชุดบันนังสตา", "95", ["rescue"], 41, 28, 120, 2, 14, 10, 29),
  unit("u5", "มูลนิธิตัวอย่าง ง.", "ชุดตากใบ", "96", ["rescue"], 33, 22, 95, 2, 11, 7, 35),
  unit(
    "u6",
    "อบต.ตัวอย่าง สุไหงโก-ลก",
    "ชุดเรือสุไหงโก-ลก",
    "96",
    ["rescue", "coordination"],
    28,
    19,
    82,
    1,
    10,
    7,
    null,
  ),
  unit("u7", "มูลนิธิตัวอย่าง จ.", "ชุดหาดใหญ่", "90", ["rescue"], 24, 17, 73, 3, 9, 6, 22),
  unit(
    "u8",
    "ทีมอาสาตัวอย่าง ฉ.",
    "ชุดระโนด",
    "90",
    ["rescue", "support"],
    22,
    15,
    64,
    1,
    8,
    5,
    null,
  ),
  unit("u9", "มูลนิธิตัวอย่าง ช.", "ชุดสายบุรี", "94", ["rescue"], 19, 13, 56, 2, 7, 4, 16),
  unit(
    "u10",
    "ปกครองตัวอย่าง รามัน",
    "ชุดประสานงานรามัน",
    "95",
    ["coordination", "planning"],
    17,
    11,
    47,
    2,
    6,
    4,
    13,
  ),
  unit(
    "u11",
    "มูลนิธิตัวอย่าง ซ.",
    "ชุดเรือ เมืองนราธิวาส",
    "96",
    ["rescue"],
    20,
    13,
    56,
    1,
    7,
    5,
    null,
  ),
  unit("u12", "ทีมอาสาตัวอย่าง ฌ.", "ชุดจะนะ", "90", ["rescue"], 14, 8, 31, 1, 5, 3, null),
];

export const EXAMPLE_IMPACT: ImpactSeason = {
  from: "2026-11-01",
  to: "2026-12-31",
  computedAt: EXAMPLE_COMPUTED_AT,
  totals: {
    requestsCarried: 412,
    teamsThatAccepted: 12,
    confirmedRescues: 268,
    peopleReached: 1147,
    vulnerableInvolved: 319,
  },
  // 268 + 71 + 48 + 25 = 412 requests.
  outcomes: [
    { outcome: "confirmed", cases: 268 },
    { outcome: "unconfirmed", cases: 71 },
    { outcome: "cancelled", cases: 48 },
    { outcome: "noTeam", cases: 25 },
  ],
  // 86 + 142 + 96 + 51 + 12 = 387 = the 412 requests less the 25 nobody accepted.
  waits: [
    { band: "under1", cases: 86 },
    { band: "to5", cases: 142 },
    { band: "to15", cases: 96 },
    { band: "to60", cases: 51 },
    { band: "over60", cases: 12 },
  ],
  medianAcceptMinutes: 4,
  longestAcceptMinutes: 97,
  // Nine weeks: the flood peak falls in the last week of November.
  weeks: [
    { from: "2026-11-01", requests: 12, confirmed: 8 },
    { from: "2026-11-08", requests: 23, confirmed: 15 },
    { from: "2026-11-15", requests: 41, confirmed: 28 },
    { from: "2026-11-22", requests: 118, confirmed: 76 },
    { from: "2026-11-29", requests: 87, confirmed: 59 },
    { from: "2026-12-06", requests: 54, confirmed: 36 },
    { from: "2026-12-13", requests: 39, confirmed: 25 },
    { from: "2026-12-20", requests: 24, confirmed: 15 },
    { from: "2026-12-27", requests: 14, confirmed: 6 },
  ],
  // 141 + 105 + 101 + 65 = 412 requests; 102 + 72 + 60 + 34 = 268 rescues.
  provinces: [
    { province: "94", requests: 141, confirmed: 102, teams: 3, openedApp: 9840 },
    { province: "95", requests: 105, confirmed: 72, teams: 3, openedApp: 7120 },
    { province: "96", requests: 101, confirmed: 60, teams: 3, openedApp: 6450 },
    { province: "90", requests: 65, confirmed: 34, teams: 3, openedApp: 11230 },
  ],
  units: UNITS,
  gaps: [
    { tambon: "950505", name: "อัยเยอร์เวง", district: "เบตง", province: "95" },
    { tambon: "960807", name: "ภูเขาทอง", district: "สุคิริน", province: "96" },
    { tambon: "900905", name: "ทุ่งหมอ", district: "สะเดา", province: "90" },
  ],
};
