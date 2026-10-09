/**
 * Made-up examples for the /dev review pages only (decision 2026-10-08): nothing here is in the
 * database, and the pages that show it are not available in production. The tambons are real so
 * the screens read naturally; the alerts, places, reports and gauges are invented.
 */
import type { Area, AreaDirectory } from "@/lib/area";
import type { Hazard } from "@/lib/hazards";
import type { MapData } from "@/lib/map-data";
import type { DamSignal } from "@/lib/dam";
import type { MyPlaces } from "@/lib/me";
import type { NearbyPlaces, SafePlace } from "@/lib/places";
import type { PublicAlert, PublicStatus } from "@/lib/public-status";
import { HOME_COLOR, mineColor } from "@/lib/mine-colors";
import type { Weather, WeatherDay, WeatherHour, WeatherPlace } from "@/lib/weather";
import type { WeatherGrid } from "@/lib/weather-grid";
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

export const WEATHER_SCENARIOS = ["forecast", "skies", "choose", "offline"] as const;
export type WeatherScenario = (typeof WEATHER_SCENARIOS)[number];

/**
 * A made-up forecast for the weather example page: a wet afternoon in the north-east monsoon,
 * easing over the week. Shaped like Open-Meteo's answer after our server has reduced it, so the
 * example and the real thing go through exactly the same screen.
 */
function exampleWeather(): Weather {
  const hour = 3_600_000;
  const start = Math.floor(EXAMPLE_NOW / hour) * hour;
  // Bangkok is UTC+7: the local hour decides when it rains and when it is dark.
  const localHour = (at: number) => Math.floor(at / hour + 7) % 24;
  const rainAt = (at: number) => {
    const h = localHour(at);
    const day = Math.floor((at - start) / (24 * hour));
    const strength = Math.max(0, 1 - day * 0.25);
    if (h >= 13 && h <= 19) return Math.round(strength * (h === 16 ? 11 : 4) * 10) / 10;
    if (h >= 20 && h <= 22) return Math.round(strength * 1.2 * 10) / 10;
    return 0;
  };
  const codeFor = (rain: number) => (rain > 6 ? 95 : rain > 2 ? 65 : rain > 0 ? 61 : 3);

  const hours: WeatherHour[] = Array.from({ length: 48 }, (_, i) => {
    const at = start + i * hour;
    const rain = rainAt(at);
    const h = localHour(at);
    return {
      at: new Date(at).toISOString(),
      tempC: 24 + (h >= 10 && h <= 17 ? 6 : h >= 7 && h <= 20 ? 3 : 0),
      code: codeFor(rain),
      rainMm: rain,
      chance: rain > 0 ? Math.min(95, 40 + rain * 6) : 20,
      isDay: h >= 6 && h < 18,
    };
  });

  const days: WeatherDay[] = Array.from({ length: 7 }, (_, d) => {
    const noon = start - (localHour(start) - 12) * hour + d * 24 * hour;
    const rain = Math.round(Math.max(0, 38 - d * 6) * 10) / 10;
    return {
      date: new Date(noon).toISOString().slice(0, 10),
      at: new Date(noon).toISOString(),
      code: codeFor(rain / 6),
      maxC: 30 - d * 0.5,
      minC: 24,
      rainMm: rain,
      chance: Math.max(20, 95 - d * 9),
    };
  });

  return {
    lat: 6.88,
    lon: 101.27,
    timezone: "Asia/Bangkok",
    at: new Date(EXAMPLE_NOW).toISOString(),
    tempC: 27.4,
    feelsC: 32.1,
    humidity: 88,
    rainMm: 2.6,
    windKmh: 14,
    windFrom: "ne",
    isDay: true,
    code: 65,
    hours,
    days,
  };
}

export const EXAMPLE_WEATHER = exampleWeather();

/** The place the weather example is for: the same tambon as the home examples. */
export const EXAMPLE_WEATHER_PLACE: WeatherPlace = {
  name: BANA.nameTh,
  area: BANA.provinceTh,
  country: null,
  countryCode: "TH",
  lat: BANA.lat,
  lon: BANA.lon,
  from: "area",
};

/**
 * A made-up grid for the weather-map example: a rain band crossing from the west, warmer
 * towards the coast, wind from the north-east. Shaped exactly as /api/public/weather/grid
 * answers, so the example and the real thing go through the same screen.
 */
function exampleGrid(): WeatherGrid {
  const span = 1.2;
  const n = 9;
  const step = span / (n - 1);
  const hour = 3_600_000;
  const start = Math.floor(EXAMPLE_NOW / hour) * hour;
  const hours = Array.from({ length: 24 }, (_, h) => new Date(start + h * hour).toISOString());
  const grid: WeatherGrid = {
    lat: 6.9,
    lon: 101.25,
    span,
    n,
    step,
    timezone: "Asia/Bangkok",
    hours,
    temp: [],
    humidity: [],
    rain: [],
    wind: [],
    windDir: [],
  };
  for (let row = 0; row < n; row += 1) {
    for (let col = 0; col < n; col += 1) {
      for (let h = 0; h < hours.length; h += 1) {
        // The band sits over one column at a time and walks east, fading as it goes.
        const front = ((h / 2.5) % (n + 4)) - 2;
        const distance = Math.abs(col - front);
        const rain = distance < 1.6 ? Math.round((9 - distance * 5) * 10) / 10 : 0;
        grid.rain.push(Math.max(0, rain));
        grid.temp.push(Math.round((31 - row * 0.4 - (rain > 0 ? 3 : 0)) * 10) / 10);
        grid.humidity.push(Math.min(99, 72 + Math.round(rain * 2) + row));
        grid.wind.push(8 + ((col + h) % 5) * 3);
        grid.windDir.push(45 + ((row + h) % 4) * 10);
      }
    }
  }
  return grid;
}

export const EXAMPLE_GRID = exampleGrid();

/** The pins on the example map: the place the page is about, and two places watched nearby. */
export const EXAMPLE_PINS = [
  {
    id: "here",
    label: BANA.nameTh,
    lat: BANA.lat,
    lon: BANA.lon,
    home: true,
    color: HOME_COLOR,
    lines: [],
    call: null,
  },
  {
    id: "p1",
    label: "บ้านแม่",
    lat: 6.72,
    lon: 101.48,
    home: false,
    color: mineColor(0),
    lines: [],
    call: null,
  },
  {
    id: "p2",
    label: "โรงเรียนน้อง",
    lat: 7.05,
    lon: 101.12,
    home: false,
    color: mineColor(1),
    lines: [],
    call: null,
  },
];

/*
 * The dam's figures in each state it can be in (spec section 15). A release happens in a handful
 * of hours a year, so these are the only way to look at the quiet notice and the card before one
 * does. The geometry is not made up: the example page reads the real river from
 * /api/public/dam and swaps only the figures, so what is on screen is the real path.
 *
 * Every number is in the range the archive actually holds (pipeline/dam_release/METHODS.md):
 * storage up to 1,504 Mm3, the January 2021 spill peak of 648 m3/s, turbine releases near 100.
 */
export type DamScenario = "quiet" | "watch" | "releasing" | "awaiting" | "stale" | "none";

export const DAM_SCENARIOS: DamScenario[] = [
  "quiet",
  "watch",
  "releasing",
  "awaiting",
  "stale",
  "none",
];

const damSignal = (over: Partial<DamSignal>): DamSignal => ({
  observedAt: new Date(EXAMPLE_NOW - 3 * 3_600_000).toISOString(),
  fetchedAt: new Date(EXAMPLE_NOW - 20 * 60_000).toISOString(),
  storageMcm: 745,
  percentFull: 46.9,
  levelM: 99.53,
  inflowCms: 103,
  releasedCms: 103,
  spilledCms: 0,
  outflowCms: 103,
  riseMcmPerH: -0.1,
  riseWindowH: 6,
  grade: "quiet",
  reasons: [],
  awaiting: [],
  readings: 10,
  stale: false,
  confirmedOver: 2,
  ...over,
});

export function exampleDamSignal(scenario: DamScenario): DamSignal | null {
  switch (scenario) {
    case "none":
      return null;
    case "watch":
      // Above normal high water and filling: the 2021 event looked like this first.
      return damSignal({
        grade: "watchful",
        reasons: ["above_normal_high", "rising_fast"],
        storageMcm: 1460,
        percentFull: 91.8,
        levelM: 114.2,
        inflowCms: 520,
        riseMcmPerH: 5.2,
      });
    case "releasing":
      // January 2021: storage at 103.5% and a spill peak near 648 m3/s.
      return damSignal({
        grade: "releasing",
        reasons: ["spilling", "above_turbines", "above_normal_high"],
        storageMcm: 1504,
        percentFull: 94.6,
        levelM: 115.8,
        inflowCms: 780,
        releasedCms: 140,
        spilledCms: 648,
        outflowCms: 788,
        riseMcmPerH: 2.1,
      });
    case "awaiting":
      // The impossible hour of 26 June 2015: shown, never graded on.
      return damSignal({
        grade: "quiet",
        awaiting: ["release_unconfirmed"],
        releasedCms: 1944,
        outflowCms: 1944,
        readings: 10,
      });
    case "stale":
      return damSignal({
        observedAt: new Date(EXAMPLE_NOW - 26 * 3_600_000).toISOString(),
        stale: true,
        riseMcmPerH: null,
        readings: 2,
      });
    default:
      return damSignal({});
  }
}
