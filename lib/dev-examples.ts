/**
 * Made-up examples for the /dev review pages only (decision 2026-10-08): nothing here is in the
 * database, and the pages that show it are not available in production. The tambons are real so
 * the screens read naturally; the alerts, places, reports and gauges are invented.
 */
import type { Area, AreaDirectory } from "@/lib/area";
import type { Hazard } from "@/lib/hazards";
import type { MapData } from "@/lib/map-data";
import type { MyPlaces } from "@/lib/me";
import type { NearbyPlaces, SafePlace } from "@/lib/places";
import type { PublicAlert, PublicStatus } from "@/lib/public-status";
import type { AlertLevel } from "@/lib/brand/tokens";

/** The examples are seen at 16:30 Bangkok time on 20 November 2026. */
export const EXAMPLE_NOW = Date.parse("2026-11-20T09:30:00Z");
const ago = (minutes: number) => new Date(EXAMPLE_NOW - minutes * 60_000).toISOString();
const ahead = (minutes: number) => ago(-minutes);

const pattani = { provinceTh: "ปัตตานี", provinceEn: "Pattani" };
const mueang = { districtTh: "เมืองปัตตานี", districtEn: "Mueang Pattani" };

export const BANA: Area = {
  code: "940104",
  nameTh: "บานา",
  nameEn: "Bana",
  ...mueang,
  ...pattani,
  lat: 6.87821,
  lon: 101.27191,
  from: "list",
};
const TALUBO: Area = {
  code: "940111",
  nameTh: "ตะลุโบะ",
  nameEn: "Talu Bo",
  ...mueang,
  ...pattani,
  lat: 6.85129,
  lon: 101.27205,
  from: "account",
};

export function exampleAlert(
  level: AlertLevel,
  tambons: string[],
  more: Partial<PublicAlert> = {},
): PublicAlert {
  return {
    id: `example-${level}-${tambons[0]}`,
    hazard: "flood",
    level,
    reason: "ระดับน้ำแม่น้ำปัตตานีที่สถานีตัวอย่างสูงขึ้นต่อเนื่อง และมีฝนตกหนักเหนือน้ำ",
    messages: {
      th: "ตัวอย่างข้อความประกาศ: โปรดติดตามสถานการณ์และทำตามรายการด้านล่าง",
      en: "Example alert text: follow the situation and work through the list below.",
    },
    issuedAt: ago(90),
    nextUpdateAt: ahead(150),
    onset: null,
    returnWindow: null,
    source: "กรมชลประทาน (ตัวอย่าง)",
    tambons,
    ...more,
  };
}

export function exampleStatus(alerts: PublicAlert[], inService = true): PublicStatus {
  return { generatedAt: ago(1), inService, alerts };
}

const place = (id: string, th: string, en: string, more: Partial<SafePlace>): SafePlace => ({
  id,
  name: { th, en },
  type: "school",
  status: "open",
  verified: true,
  distanceM: 900,
  lat: 6.8831,
  lon: 101.2803,
  freeboardM: 1.8,
  flooded2024: false,
  flooded2025: false,
  capacity: 300,
  needs: null,
  updatedAt: ago(200),
  ...more,
});

export const EXAMPLE_PLACES: NearbyPlaces = {
  people: [
    place("p1", "โรงเรียนตัวอย่าง 1", "Example School 1", {}),
    place("p2", "มัสยิดตัวอย่าง", "Example Mosque", {
      type: "mosque",
      status: "full",
      distanceM: 1700,
      lat: 6.8702,
      lon: 101.2611,
      freeboardM: 0.9,
      flooded2025: true,
      capacity: 120,
      needs: "น้ำดื่ม ผ้าห่ม",
    }),
    place("p3", "ศูนย์พักพิงตัวอย่าง", "Example Shelter", {
      type: "shelter",
      status: "unknown",
      verified: false,
      distanceM: 4300,
      lat: 6.8448,
      lon: 101.2502,
      freeboardM: null,
      flooded2024: null,
      flooded2025: null,
      capacity: null,
    }),
  ],
  parking: [
    place("p4", "ลานจอดรถที่สูงตัวอย่าง", "Example high-ground car park", {
      type: "high_ground_parking",
      distanceM: 2600,
      lat: 6.8623,
      lon: 101.2954,
      freeboardM: 2.4,
      capacity: null,
    }),
  ],
};

export const EXAMPLE_ME: MyPlaces = {
  signedIn: true,
  home: null,
  places: [
    {
      id: "w1",
      label: "บ้านแม่",
      area: TALUBO,
      contactName: "แม่",
      contactPhone: "0800000000",
    },
    {
      id: "w2",
      label: "ร้านที่ตลาด",
      area: { ...BANA, code: "940101", nameTh: "สะบารัง", nameEn: "Sabarang", from: "account" },
      contactName: null,
      contactPhone: null,
    },
  ],
};

export const EXAMPLE_HAZARDS: Hazard[] = [
  {
    code: "flood",
    status: "active",
    name: { th: "น้ำท่วม", ms: "Banjir", en: "Flood" },
    description: {},
    placeholder: {},
    hotline: "1784",
  },
  {
    code: "fire",
    status: "coming_soon",
    name: { th: "ไฟไหม้", ms: "Kebakaran", en: "Fire" },
    description: {
      th: "จุดความร้อนจากดาวเทียมและไฟป่าพรุ",
      ms: "Titik panas satelit dan kebakaran hutan paya gambut",
      en: "Satellite hotspots and peat-swamp fires",
    },
    placeholder: {
      th: "ยังไม่มีการเตือนภัยนี้ ไม่ได้แปลว่าไม่มีความเสี่ยง หากเกิดเหตุ กด SOS หรือโทร 199",
      ms: "Amaran untuk bencana ini belum tersedia. Ini tidak bermakna tiada risiko. Jika berlaku, tekan SOS atau telefon 199.",
      en: "Warnings for this hazard aren't available yet. This does not mean there is no risk. In an emergency, press SOS or call 199.",
    },
    hotline: "199",
  },
];

export const EXAMPLE_DIRECTORY: AreaDirectory = {
  provinces: [
    { code: "10", nameTh: "กรุงเทพมหานคร", nameEn: "Bangkok", status: "coming_soon" },
    { code: "90", nameTh: "สงขลา", nameEn: "Songkhla", status: "active" },
    { code: "94", nameTh: "ปัตตานี", nameEn: "Pattani", status: "active" },
    { code: "95", nameTh: "ยะลา", nameEn: "Yala", status: "active" },
    { code: "96", nameTh: "นราธิวาส", nameEn: "Narathiwat", status: "active" },
  ],
  tambons: [
    BANA,
    TALUBO,
    { ...BANA, code: "940101", nameTh: "สะบารัง", nameEn: "Sabarang" },
    { ...BANA, code: "940102", nameTh: "อาเนาะรู", nameEn: "A Noru" },
    { ...BANA, code: "940103", nameTh: "จะบังติกอ", nameEn: "Chabang Tiko" },
    { ...BANA, code: "940105", nameTh: "ตันหยงลุโละ", nameEn: "Tanyong Lulo" },
    { ...BANA, code: "940112", nameTh: "บาราเฮาะ", nameEn: "Bara Ho" },
  ].map((a) => ({
    code: a.code,
    nameTh: a.nameTh,
    nameEn: a.nameEn,
    districtCode: "9401",
    districtTh: a.districtTh,
    districtEn: a.districtEn,
    provinceCode: "94",
    lat: a.lat,
    lon: a.lon,
  })),
};

/** A hexagon of about 1 km2 around a point, like report_hex_bins() makes. */
function hexagon(lon: number, lat: number): MapData["reports"][number]["hex"] {
  const ring = Array.from({ length: 7 }, (_, i) => {
    const angle = (Math.PI / 3) * (i % 6);
    return [lon + 0.0054 * Math.cos(angle), lat + 0.0054 * Math.sin(angle)];
  });
  return { type: "Polygon", coordinates: [ring] };
}

export const EXAMPLE_MAP: MapData = {
  places: [...EXAMPLE_PLACES.people, ...EXAMPLE_PLACES.parking].map((p) => ({
    ...p,
    distanceM: null,
  })),
  reports: [
    { hex: hexagon(101.262, 6.858), count: 7, deepest: "waist", latest: ago(60) },
    { hex: hexagon(101.281, 6.849), count: 2, deepest: "knee", latest: ago(180) },
  ],
  gauges: [
    {
      id: "g1",
      name: { th: "สถานีวัดระดับน้ำตัวอย่าง", en: "Example river gauge" },
      lat: 6.842,
      lon: 101.262,
      value: 3.42,
      observedAt: ago(40),
      status: "above_watch",
    },
  ],
};

export const HOME_SCENARIOS = [
  "choose",
  "notInService",
  "normal",
  "watch",
  "warning",
  "evacuate",
  "stale",
  "return",
  "watched",
  "unavailable",
] as const;
export type HomeScenario = (typeof HOME_SCENARIOS)[number];

/** What the home screen is given in each example. */
export function homeExample(scenario: HomeScenario): {
  status: PublicStatus | null;
  area: Area | null;
  me: MyPlaces | null;
  failed: boolean;
} {
  const here = [BANA.code];
  const base = { area: BANA, me: null, failed: false };
  switch (scenario) {
    case "choose":
      return { ...base, area: null, status: exampleStatus([]) };
    case "notInService":
      return { ...base, status: exampleStatus([], false) };
    case "normal":
      return { ...base, status: exampleStatus([]) };
    case "watch":
      return { ...base, status: exampleStatus([exampleAlert("watch", here)]) };
    case "warning":
      return {
        ...base,
        status: exampleStatus([
          exampleAlert("warning", here, {
            onset: [ahead(26 * 60), ahead(64 * 60)],
            returnWindow: [ahead(96 * 60), ahead(120 * 60)],
          }),
        ]),
      };
    case "evacuate":
      return { ...base, status: exampleStatus([exampleAlert("evacuate", here)]) };
    case "stale":
      return {
        ...base,
        status: exampleStatus([
          exampleAlert("warning", here, { issuedAt: ago(400), nextUpdateAt: ago(150) }),
        ]),
      };
    case "return":
      return { ...base, status: exampleStatus([exampleAlert("return", here)]) };
    case "watched":
      return {
        ...base,
        me: EXAMPLE_ME,
        status: exampleStatus([exampleAlert("evacuate", ["940111"]), exampleAlert("watch", here)]),
      };
    case "unavailable":
      return { ...base, status: null, failed: true };
  }
}
