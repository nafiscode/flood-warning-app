/**
 * Made-up usage for /dev/usage (the owner, 14 Oct), so the dashboard can be judged before real
 * phones are counted. A season-time picture: a Warning alert went out in the afternoon and people
 * turned to the app. Deterministic (a seeded sequence, a fixed "now"), so the server's page and
 * the browser's draw the same thing. The tambons and their centre points are real.
 */
import type { TambonCount, UsageData, UsageWindow, WatchedTambon } from "@/lib/usage";

export const EXAMPLE_NOW = "2026-11-24T09:20:00.000Z";

/** [code, Thai name, English name, province, lat, lon] */
const TAMBONS: [string, string, string, string, number, number][] = [
  ["940109", "ปะกาฮะรัง", "Paka Harang", "94", 6.8379, 101.2332],
  ["900310", "จะโหนง", "Chanong", "90", 7.0061, 100.6624],
  ["950601", "กายูบอเกาะ", "Kayu Boko", "95", 6.4898, 101.4211],
  ["960502", "ตันหยงลิมอ", "Tanyong Limo", "96", 6.2843, 101.7751],
  ["901112", "ทุ่งตำเสา", "Thung Tam Sao", "90", 6.92, 100.2705],
  ["940906", "ตาแกะ", "Ta Kae", "94", 6.8429, 101.3371],
  ["950609", "เนินงาม", "Noen Ngam", "95", 6.5088, 101.3488],
  ["960507", "กาลิซา", "Kalisa", "96", 6.226, 101.6557],
  ["901204", "คลองหรัง", "Khlong Rang", "90", 6.9229, 100.5874],
  ["940602", "พิเทน", "Phithen", "94", 6.6741, 101.4714],
  ["950615", "อาซ่อง", "A Song", "95", 6.5219, 101.4511],
  ["900209", "วัดจันทร์", "Wat Chan", "90", 7.3823, 100.4607],
  ["940710", "แป้น", "Paen", "94", 6.7449, 101.5503],
  ["960603", "เรียง", "Riang", "96", 6.3857, 101.4451],
  ["901503", "ทำนบ", "Thamnop", "90", 7.2354, 100.5074],
  ["950506", "ตาชี", "Ta Chi", "95", 6.5639, 101.1042],
  ["940910", "หนองแรต", "Nong Raet", "94", 6.8506, 101.4051],
  ["950616", "ตะโล๊ะหะลอ", "Talo Halo", "95", 6.4804, 101.477],
  ["940914", "สาบัน", "Saban", "94", 6.8205, 101.4438],
  ["900707", "ปากแตระ", "Pak Trae", "90", 7.7655, 100.3581],
];

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const at = (code: string, n: number): TambonCount => {
  const t = TAMBONS.find((x) => x[0] === code) ?? TAMBONS[0]!;
  return { code: t[0], nameTh: t[1], nameEn: t[2], province: t[3], lat: t[4], lon: t[5], n };
};

export function exampleUsage(days: UsageWindow): UsageData {
  const rnd = seeded(days * 7919);
  const now = Date.parse(EXAMPLE_NOW);
  const day = (offset: number) =>
    new Date(now + 7 * 3_600_000 - offset * 86_400_000).toISOString().slice(0, 10);

  const liveTambons = TAMBONS.slice(0, 9).map((t, i) =>
    at(t[0], Math.max(1, Math.round(14 / (i + 1) + rnd() * 3))),
  );
  const noArea = 9;
  const live = liveTambons.reduce((a, t) => a + t.n, 0) + noArea;

  const series = Array.from({ length: days }, (_, i) => {
    const offset = days - 1 - i;
    const surge = offset <= 2 ? 2.6 - offset * 0.6 : 1;
    const devices = Math.round((140 + rnd() * 70 + (days - offset) * 1.5) * surge);
    const newDevices = Math.round(devices * (0.08 + rnd() * 0.1));
    return {
      day: day(offset),
      devices,
      newDevices,
      returning: devices - newDevices,
      sessions: Math.round(devices * (1.4 + rnd() * 0.5)),
      views: Math.round(devices * (4 + rnd() * 2)),
      minutes: Math.round(devices * (3 + rnd() * 2)),
    };
  });
  const today = series[series.length - 1]!;

  const hours = Array.from({ length: 48 }, (_, i) => {
    const t = new Date(Math.floor(now / 3_600_000) * 3_600_000 - (47 - i) * 3_600_000);
    const h = (t.getUTCHours() + 7) % 24;
    const daily = h < 6 ? 2 : h < 9 ? 18 : h < 18 ? 26 : h < 22 ? 34 : 10;
    const afterAlert = i >= 44 ? 3.2 : 1;
    return { t: t.toISOString(), n: Math.round((daily + rnd() * 8) * afterAlert) };
  });
  const pulse = Array.from({ length: 37 }, (_, i) => {
    const t = new Date(Math.floor(now / 300_000) * 300_000 - (36 - i) * 300_000);
    return { t: t.toISOString(), n: Math.round((i > 24 ? 70 : 28) + rnd() * 14) };
  });

  const rhythm: UsageData["rhythm"] = [];
  for (let dow = 1; dow <= 7; dow++) {
    for (let hour = 0; hour < 24; hour++) {
      const base =
        hour < 5 ? 1 : hour < 8 ? 6 : hour < 12 ? 12 : hour < 17 ? 10 : hour < 22 ? 18 : 4;
      const friday = dow === 5 && hour >= 11 && hour <= 13 ? 0.4 : 1;
      rhythm.push({ dow, hour, n: Math.round(base * friday * (days / 7) * (0.7 + rnd() * 0.6)) });
    }
  }

  const devices = Math.round(series.reduce((a, d) => a + d.devices, 0) * (days > 1 ? 0.45 : 1));
  const areas = TAMBONS.map((t, i) => at(t[0], Math.round((devices * 0.5) / (i + 2) + rnd() * 6)));
  const watched: WatchedTambon[] = TAMBONS.slice(0, 14).map((t, i) => ({
    code: t[0],
    nameTh: t[1],
    nameEn: t[2],
    province: t[3],
    lat: t[4],
    lon: t[5],
    places: Math.round(30 / (i + 1) + rnd() * 4),
    owners: Math.round(20 / (i + 1) + rnd() * 3),
    homes: Math.round(12 / (i + 1) + rnd() * 2),
  }));

  return {
    at: EXAMPLE_NOW,
    days,
    now: {
      live,
      signedIn: Math.round(live * 0.22),
      installed: Math.round(live * 0.41),
      tambons: liveTambons,
      noArea,
      places: [
        { country: "TH", city: "Hat Yai", lat: 7, lon: 100.5, n: 22 },
        { country: "TH", city: "Pattani", lat: 6.9, lon: 101.3, n: 18 },
        { country: "TH", city: "Bangkok", lat: 13.8, lon: 100.5, n: 9 },
        { country: "MY", city: "Kota Bharu", lat: 6.1, lon: 102.2, n: 4 },
        { country: "MY", city: "Kuala Lumpur", lat: 3.1, lon: 101.7, n: 2 },
      ],
      screens: [
        { k: "/", n: Math.round(live * 0.48) },
        { k: "/map", n: Math.round(live * 0.31) },
        { k: "/sos", n: 3 },
      ],
      devices: [
        { k: "phone", n: Math.round(live * 0.88) },
        { k: "desktop", n: Math.round(live * 0.1) },
      ],
    },
    pulse,
    hours,
    today: {
      devices: today.devices,
      sessions: today.sessions,
      views: today.views,
      newDevices: today.newDevices,
      minutes: today.minutes,
    },
    series,
    totals: {
      devicesEver: 4_812,
      sessionsEver: 21_390,
      viewsEver: 96_205,
      minutesEver: 61_440,
      since: "2026-10-25",
      devices,
      installed: Math.round(devices * 0.38),
      pushOn: Math.round(devices * 0.17),
      signedIn: Math.round(devices * 0.21),
      watching: Math.round(devices * 0.07),
      withArea: Math.round(devices * 0.64),
      abroad: Math.round(devices * 0.04),
      abroadWatching: Math.round(devices * 0.02),
    },
    rhythm,
    mix: {
      device: [
        { k: "phone", n: Math.round(devices * 0.86) },
        { k: "desktop", n: Math.round(devices * 0.1) },
        { k: "tablet", n: Math.round(devices * 0.04) },
      ],
      os: [
        { k: "Android", n: Math.round(devices * 0.71) },
        { k: "iOS", n: Math.round(devices * 0.16) },
        { k: "Windows", n: Math.round(devices * 0.08) },
        { k: "macOS", n: Math.round(devices * 0.03) },
        { k: "iPadOS", n: Math.round(devices * 0.02) },
      ],
      browser: [
        { k: "Chrome", n: Math.round(devices * 0.52) },
        { k: "Samsung Internet", n: Math.round(devices * 0.12) },
        { k: "Safari", n: Math.round(devices * 0.14) },
        { k: "Facebook", n: Math.round(devices * 0.11) },
        { k: "LINE", n: Math.round(devices * 0.08) },
        { k: "Edge", n: Math.round(devices * 0.03) },
      ],
      inApp: [
        { k: "Facebook", n: Math.round(devices * 0.11) },
        { k: "LINE", n: Math.round(devices * 0.08) },
        { k: "Messenger", n: Math.round(devices * 0.03) },
      ],
      locale: [
        { k: "th", n: Math.round(devices * 0.83) },
        { k: "ms", n: Math.round(devices * 0.13) },
        { k: "en", n: Math.round(devices * 0.04) },
      ],
      net: [
        { k: "4g", n: Math.round(devices * 0.58) },
        { k: "3g", n: Math.round(devices * 0.21) },
        { k: "2g", n: Math.round(devices * 0.03) },
        { k: "unknown", n: Math.round(devices * 0.18) },
      ],
      memory: [
        { k: "gt4", n: Math.round(devices * 0.31) },
        { k: "le2", n: Math.round(devices * 0.24) },
        { k: "le4", n: Math.round(devices * 0.27) },
        { k: "unknown", n: Math.round(devices * 0.18) },
      ],
      country: [
        { k: "TH", n: Math.round(devices * 0.95) },
        { k: "MY", n: Math.round(devices * 0.03) },
        { k: "SA", n: Math.round(devices * 0.01) },
        { k: "none", n: Math.round(devices * 0.01) },
      ],
    },
    screens: [
      { k: "/", views: devices * 3, devices: Math.round(devices * 0.95) },
      { k: "/map", views: devices * 2, devices: Math.round(devices * 0.6) },
      { k: "/weather", views: Math.round(devices * 0.8), devices: Math.round(devices * 0.3) },
      { k: "/account", views: Math.round(devices * 0.4), devices: Math.round(devices * 0.2) },
      {
        k: "/account/places",
        views: Math.round(devices * 0.2),
        devices: Math.round(devices * 0.08),
      },
      { k: "/report", views: Math.round(devices * 0.06), devices: Math.round(devices * 0.04) },
      { k: "/sos", views: Math.round(devices * 0.03), devices: Math.round(devices * 0.02) },
    ],
    entries: [
      { k: "/", n: Math.round(devices * 1.1) },
      { k: "/map", n: Math.round(devices * 0.2) },
      { k: "/requests", n: Math.round(devices * 0.03) },
    ],
    areas,
    ipPlaces: [
      { country: "TH", city: "Hat Yai", lat: 7, lon: 100.5, n: Math.round(devices * 0.3) },
      { country: "TH", city: "Pattani", lat: 6.9, lon: 101.3, n: Math.round(devices * 0.22) },
      { country: "TH", city: "Yala", lat: 6.5, lon: 101.3, n: Math.round(devices * 0.16) },
      { country: "TH", city: "Narathiwat", lat: 6.4, lon: 101.8, n: Math.round(devices * 0.12) },
      { country: "TH", city: "Bangkok", lat: 13.8, lon: 100.5, n: Math.round(devices * 0.08) },
      { country: "MY", city: "Kota Bharu", lat: 6.1, lon: 102.2, n: Math.round(devices * 0.02) },
      { country: "MY", city: "Kuala Lumpur", lat: 3.1, lon: 101.7, n: Math.round(devices * 0.01) },
      {
        country: "SA",
        city: "Mecca",
        lat: 21.4,
        lon: 39.8,
        n: Math.max(1, Math.round(devices * 0.005)),
      },
    ],
    watched,
    engagement: {
      medianSeconds: 158,
      medianViews: 4,
      sessionsPerDevice: 1.7,
      cohort: 1_230,
      backWithinWeek: 541,
      stillAfterWeek: 402,
      dau: 172,
      mau: 1_480,
    },
    speed: { fcp50: 1_380, fcp75: 3_420, ready50: 2_150, ready75: 4_900, measured: 3_812 },
    actions: {
      sos: 6,
      reports: 41,
      accounts: 88,
      watchedPlaces: 57,
      pushSubs: 134,
      lineFollows: 62,
    },
    alerts: [{ at: new Date(now - 2.4 * 3_600_000).toISOString(), level: "warning" }],
  };
}
