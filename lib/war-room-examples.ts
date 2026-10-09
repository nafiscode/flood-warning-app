/**
 * Made-up data for /dev/war-room, the review page for the admin war room (same rule as
 * lib/dev-examples.ts: nothing here is in the database and the page is not available in
 * production). The tambons, districts and provinces are real, so the screen reads naturally;
 * every case, person, number and report is invented.
 *
 * There is no phone number in here either, invented or not: the board never carries one, and the
 * example page shows exactly what the real one does.
 */
import type {
  Person,
  PeoplePage,
  SosCase,
  WarRoomBoard,
  WarRoomMapData,
  WatchedCount,
} from "@/lib/war-room";

/** The example is seen at 16:30 Bangkok time on 20 November 2026, like the other /dev pages. */
export const EXAMPLE_NOW = Date.parse("2026-11-20T09:30:00Z");
const ago = (minutes: number) => new Date(EXAMPLE_NOW - minutes * 60_000).toISOString();

type Area = {
  code: string;
  th: string;
  en: string;
  dth: string;
  pth: string;
  province: string;
  lat: number;
  lon: number;
};

const AREAS: Record<string, Area> = {
  boYang: {
    code: "900101",
    th: "บ่อยาง",
    en: "Bo Yang",
    dth: "เมืองสงขลา",
    pth: "สงขลา",
    province: "90",
    lat: 7.20091,
    lon: 100.59429,
  },
  sadao: {
    code: "901001",
    th: "สะเดา",
    en: "Sadao",
    dth: "สะเดา",
    pth: "สงขลา",
    province: "90",
    lat: 6.64431,
    lon: 100.39395,
  },
  bana: {
    code: "940104",
    th: "บานา",
    en: "Bana",
    dth: "เมืองปัตตานี",
    pth: "ปัตตานี",
    province: "94",
    lat: 6.87801,
    lon: 101.27217,
  },
  taluBo: {
    code: "940111",
    th: "ตะลุโบะ",
    en: "Talu Bo",
    dth: "เมืองปัตตานี",
    pth: "ปัตตานี",
    province: "94",
    lat: 6.85129,
    lon: 101.2722,
  },
  taloMaena: {
    code: "940601",
    th: "ตะโละแมะนา",
    en: "Talo Maena",
    dth: "ทุ่งยางแดง",
    pth: "ปัตตานี",
    province: "94",
    lat: 6.60278,
    lon: 101.40463,
  },
  sateng: {
    code: "950101",
    th: "สะเตง",
    en: "Sateng",
    dth: "เมืองยะลา",
    pth: "ยะลา",
    province: "95",
    lat: 6.54957,
    lon: 101.28166,
  },
  thanTo: {
    code: "950401",
    th: "ธารโต",
    en: "Than To",
    dth: "ธารโต",
    pth: "ยะลา",
    province: "95",
    lat: 6.1667,
    lon: 101.22306,
  },
  kayuBoko: {
    code: "950601",
    th: "กายูบอเกาะ",
    en: "Kayu Boko",
    dth: "รามัน",
    pth: "ยะลา",
    province: "95",
    lat: 6.48979,
    lon: 101.42112,
  },
  bangNak: {
    code: "960101",
    th: "บางนาค",
    en: "Bang Nak",
    dth: "เมืองนราธิวาส",
    pth: "นราธิวาส",
    province: "96",
    lat: 6.42434,
    lon: 101.82785,
  },
  cheHe: {
    code: "960201",
    th: "เจ๊ะเห",
    en: "Che He",
    dth: "ตากใบ",
    pth: "นราธิวาส",
    province: "96",
    lat: 6.25614,
    lon: 102.04305,
  },
};

/** The same numbers every time the page is opened, so the server and the browser agree. */
function spread(seed: number) {
  let value = seed;
  return () => {
    value = (value * 1103515245 + 12345) % 2147483648;
    return value / 2147483648 - 0.5;
  };
}

const emptyCase: Omit<SosCase, "id" | "createdAt" | "status"> = {
  closedAt: null,
  hazard: "flood",
  lat: null,
  lon: null,
  accuracyM: 18,
  locationText: null,
  tambon: null,
  tambonTh: null,
  tambonEn: null,
  districtTh: null,
  provinceTh: null,
  provinceCode: null,
  peopleCount: null,
  vulnerable: {},
  depth: null,
  injuries: null,
  note: null,
  photos: 0,
  hasVoice: false,
  batteryPct: null,
  onBehalf: false,
  onBehalfNote: null,
  hasPhone: true,
  requesterName: null,
  priority: 1,
  suspectedSpam: false,
  spamDismissedAt: null,
  duplicateOf: null,
  possibleDuplicateOf: null,
  mergedIn: 0,
  unitId: null,
  unitName: null,
  orgName: null,
  claimedAt: null,
  lastEvent: "received",
  lastEventAt: null,
  unitsCovering: 2,
};

const jitter = spread(7);

function exampleCase(
  id: string,
  area: Area,
  minutesAgo: number,
  more: Partial<SosCase> = {},
): SosCase {
  return {
    ...emptyCase,
    id,
    createdAt: ago(minutesAgo),
    status: "received",
    lat: Number((area.lat + jitter() * 0.03).toFixed(5)),
    lon: Number((area.lon + jitter() * 0.03).toFixed(5)),
    tambon: area.code,
    tambonTh: area.th,
    tambonEn: area.en,
    districtTh: area.dth,
    provinceTh: area.pth,
    provinceCode: area.province,
    lastEventAt: ago(minutesAgo),
    ...more,
  };
}

const CASES: SosCase[] = [
  // Nobody has answered these two. The first is the one an admin must act on now.
  exampleCase("3f8a1c40-0000-4000-8000-000000000001", AREAS.cheHe!, 47, {
    peopleCount: 5,
    vulnerable: { elderly: true, infant_child: true },
    depth: "waist",
    note: "น้ำเข้าบ้านชั้นล่างแล้ว มีผู้สูงอายุสองคนขึ้นชั้นสองไม่ได้",
    photos: 2,
    batteryPct: 14,
    priority: 9.2,
    // No verified unit covers this tambon: the war room says so on the card.
    unitsCovering: 0,
  }),
  exampleCase("3f8a1c40-0000-4000-8000-000000000002", AREAS.bana!, 23, {
    peopleCount: 2,
    depth: "chest",
    injuries: "ลื่นล้ม ขาซ้ายเจ็บ เดินไม่ได้",
    hasVoice: true,
    photos: 1,
    batteryPct: 42,
    priority: 8.1,
  }),
  exampleCase("3f8a1c40-0000-4000-8000-000000000003", AREAS.taluBo!, 6, {
    peopleCount: 1,
    depth: "knee",
    note: "น้ำขึ้นเร็ว ขอเรือ",
    priority: 4.5,
  }),
  exampleCase("3f8a1c40-0000-4000-8000-000000000004", AREAS.sateng!, 3, {
    peopleCount: 4,
    vulnerable: { bedridden: true },
    depth: "ankle",
    onBehalf: true,
    onBehalfNote: "ลูกสาวแจ้งแทนแม่ที่อยู่คนเดียว",
    hasPhone: false,
    priority: 7.4,
  }),
  // A unit holds these.
  exampleCase("3f8a1c40-0000-4000-8000-000000000005", AREAS.kayuBoko!, 38, {
    status: "en_route",
    peopleCount: 3,
    depth: "waist",
    unitId: "unit-1",
    unitName: "ชุดกู้ภัยที่ 2",
    orgName: "มูลนิธิกู้ภัยยะลา",
    claimedAt: ago(26),
    lastEvent: "en_route",
    lastEventAt: ago(12),
    priority: 6.8,
  }),
  exampleCase("3f8a1c40-0000-4000-8000-000000000006", AREAS.boYang!, 95, {
    status: "assigned",
    peopleCount: 7,
    depth: "knee",
    photos: 3,
    unitId: "unit-2",
    unitName: "ชุดเคลื่อนที่เร็ว",
    orgName: "อบต.บ่อยาง (ตัวอย่าง)",
    claimedAt: ago(74),
    lastEvent: "assigned_by_admin",
    lastEventAt: ago(74),
    priority: 5.9,
  }),
  // Flagged as possible spam, and still on the board like any other case (safety rule 1).
  exampleCase("3f8a1c40-0000-4000-8000-000000000007", AREAS.bangNak!, 31, {
    peopleCount: 1,
    suspectedSpam: true,
    mergedIn: 3,
    note: "ทดสอบ",
    priority: 2.1,
  }),
  // GPS failed: the sender typed where they are.
  exampleCase("3f8a1c40-0000-4000-8000-000000000008", AREAS.taloMaena!, 14, {
    locationText: "หลังมัสยิดบ้านตะโละ ริมคลอง",
    accuracyM: null,
    peopleCount: 6,
    depth: "waist",
    priority: 6.1,
  }),
  // Closed.
  exampleCase("3f8a1c40-0000-4000-8000-000000000009", AREAS.thanTo!, 210, {
    status: "rescued",
    closedAt: ago(120),
    peopleCount: 4,
    depth: "chest",
    unitId: "unit-1",
    unitName: "ชุดกู้ภัยที่ 2",
    orgName: "มูลนิธิกู้ภัยยะลา",
    claimedAt: ago(190),
    lastEvent: "rescued",
    lastEventAt: ago(120),
  }),
  exampleCase("3f8a1c40-0000-4000-8000-000000000010", AREAS.sadao!, 300, {
    status: "safe_cancelled",
    closedAt: ago(280),
    peopleCount: 2,
    lastEvent: "safe_cancelled",
    lastEventAt: ago(280),
  }),
  // Older cases, so the strip of the last 24 hours has something in it.
  ...[380, 420, 540, 610, 700, 880, 1010, 1180, 1300].map((m, i) =>
    exampleCase(`3f8a1c40-0000-4000-8000-0000000001${i + 10}`, Object.values(AREAS)[i % 10]!, m, {
      status: i % 3 === 0 ? "safe_cancelled" : "rescued",
      closedAt: ago(m - 40),
      peopleCount: (i % 4) + 1,
      depth: ["knee", "waist", "ankle", "chest"][i % 4]!,
      unitName: "ชุดกู้ภัยที่ 2",
      orgName: "มูลนิธิกู้ภัยยะลา",
      claimedAt: ago(m - 12),
      lastEvent: "rescued",
      lastEventAt: ago(m - 40),
    }),
  ),
];

const WATCHED: WatchedCount[] = [
  ["bana", 34, 21, 18, 96],
  ["taluBo", 19, 14, 11, 61],
  ["sateng", 28, 22, 17, 140],
  ["bangNak", 12, 9, 8, 74],
  ["cheHe", 9, 7, 6, 23],
  ["boYang", 22, 17, 15, 118],
  ["kayuBoko", 6, 5, 4, 17],
  ["thanTo", 3, 2, 2, 8],
  ["sadao", 4, 3, 3, 12],
  ["taloMaena", 2, 1, 1, 5],
].map(([key, places, notify, owners, homes]) => {
  const a = AREAS[key as string]!;
  return {
    tambon: a.code,
    tambonTh: a.th,
    tambonEn: a.en,
    districtTh: a.dth,
    provinceCode: a.province,
    places: places as number,
    notify: notify as number,
    owners: owners as number,
    homes: homes as number,
  };
});

const NAMES = [
  "นูรฮายาตี",
  "อับดุลเลาะ",
  "สมชาย",
  "ฟาตีมะห์",
  "มะรูดิง",
  "ปรียา",
  "ฮาซัน",
  "วันดี",
  "ยูโซ๊ะ",
  "อัสมา",
  "ธีรพงษ์",
  "ซอฟียะห์",
];

const PEOPLE: Person[] = NAMES.map((name, i) => {
  const a = Object.values(AREAS)[i % 10]!;
  return {
    userId: `person-${i}`,
    displayName: name,
    role: i === 0 ? "admin" : i === 1 ? "authority" : "user",
    locale: i % 3 === 0 ? "ms" : "th",
    createdAt: ago(60 * 24 * (i + 1) + 15),
    tambon: i === 11 ? null : a.code,
    tambonTh: i === 11 ? null : a.th,
    tambonEn: i === 11 ? null : a.en,
    districtTh: i === 11 ? null : a.dth,
    provinceTh: i === 11 ? null : a.pth,
    lat: i === 11 ? null : Number((a.lat + jitter() * 0.02).toFixed(5)),
    lon: i === 11 ? null : Number((a.lon + jitter() * 0.02).toFixed(5)),
    hasPhone: i % 4 !== 3,
    phoneVerified: i % 2 === 0,
    hasLine: i % 3 !== 2,
    watchedPlaces: i % 4,
    sosSent: i === 2 ? 2 : i % 5 === 0 ? 1 : 0,
    reportsSent: i % 3,
  };
});

/** Homes, spread around each tambon in proportion to its count, for the density on the map. */
const HOME_POINTS = WATCHED.flatMap((row) => {
  const a = Object.values(AREAS).find((x) => x.code === row.tambon)!;
  return Array.from({ length: Math.min(row.homes, 40) }, () => ({
    lat: Number((a.lat + jitter() * 0.06).toFixed(5)),
    lon: Number((a.lon + jitter() * 0.06).toFixed(5)),
    tambon: a.code,
    role: "user",
  }));
});

const REPORTS = Object.values(AREAS).flatMap((a, i) =>
  Array.from({ length: (i % 3) + 1 }, (_, k) => ({
    id: `report-${a.code}-${k}`,
    createdAt: ago(30 * (i + k + 1)),
    lat: Number((a.lat + jitter() * 0.05).toFixed(5)),
    lon: Number((a.lon + jitter() * 0.05).toFixed(5)),
    tambon: a.code,
    tambonTh: a.th,
    depth: ["ankle", "knee", "waist"][(i + k) % 3]!,
    trend: ["rising", "steady", "falling"][(i + k) % 3]!,
    roadAccess: ["car", "motorbike_only", "impassable"][(i + k) % 3]!,
    moderation: (i + k) % 4 === 0 ? "pending" : "approved",
    photos: (i + k) % 3,
    anonymous: k === 1,
  })),
);

export const EXAMPLE_BOARD: WarRoomBoard = {
  now: EXAMPLE_NOW,
  cases: CASES,
  overview: {
    people: 1842,
    peopleNew7d: 213,
    peopleWithHome: 1391,
    watchedPlaces: WATCHED.reduce((n, r) => n + r.places, 0),
    watchedNotify: WATCHED.reduce((n, r) => n + r.notify, 0),
    unitsVerified: 11,
    unitsPending: 2,
    tambonsCovered: 173,
    tambonsTotal: 288,
    tambonsUncovered: 115,
    sosOpen: CASES.filter((c) => ["received", "assigned", "en_route"].includes(c.status)).length,
    sosWaiting: CASES.filter((c) => c.status === "received" && !c.unitId).length,
    sosOverdue: 3,
    sosWorking: 2,
    // 47, 23 and 31 minutes with nobody on them, against the 15-minute setting.
    sos24h: CASES.length,
    sosClosed24h: CASES.filter((c) => c.closedAt).length,
    sosSpamOpen: 1,
    oldestWaitingAt: ago(47),
    reports72h: REPORTS.length,
    reportsPending: REPORTS.filter((r) => r.moderation === "pending").length,
    unclaimedMinutes: 15,
  },
};

export const EXAMPLE_MAP_DATA: WarRoomMapData = {
  watched: WATCHED,
  people: HOME_POINTS,
  reports: REPORTS,
};

export const EXAMPLE_PEOPLE: PeoplePage = {
  rows: PEOPLE,
  total: 1842,
  search: "",
  offset: 0,
};
