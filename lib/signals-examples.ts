import type { DamLevels } from "@/lib/dam-levels";
import { exampleDamSignal } from "@/lib/dev-examples";
import type { Point, Signals, Zone } from "@/lib/signals";

/**
 * Made-up figures for /dev/signals and the tests: one zone with its river rising towards the bank
 * and heavy rain forecast, one quiet zone whose key gauge has gone silent. Nothing here is real.
 */

const HOUR = 3_600_000;
export const EXAMPLE_SIGNALS_NOW = Date.UTC(2026, 10, 26, 3, 0);

function hourly(
  from: number,
  to: number,
  value: (h: number) => number,
  now = EXAMPLE_SIGNALS_NOW,
): Point[] {
  const out: Point[] = [];
  for (let h = from; h <= to; h++) out.push([now + h * HOUR, Math.round(value(h) * 100) / 100]);
  return out;
}

const rising: Zone = {
  id: "00000000-0000-4000-8000-000000000001",
  basin: "pattani_river",
  name: { th: "แม่น้ำปัตตานี", ms: "Sungai Patani", en: "Pattani River" },
  key: {
    id: "example-X.40A",
    auto: true,
    code: "X.40A",
    thaiwaterId: 2583,
    name: { th: "บ้านท่าสาบ", en: null },
    agency: "RID",
    bank: 16.5,
    watch: 16,
    series: hourly(-96, -1, (h) => 12.6 + (h > -30 ? ((h + 30) / 29) ** 1.6 * 3.6 : 0)),
  },
  upstream: {
    id: "example-X.77",
    auto: false,
    code: "X.77",
    thaiwaterId: 1095877,
    name: { th: "บ้านหัวสะพาน", en: null },
    agency: "RID",
    bank: 39.7,
    watch: null,
    series: hourly(-96, -2, (h) => 36.4 + (h > -36 ? ((h + 36) / 34) ** 1.4 * 3.5 : 0)),
  },
  others: [
    {
      id: "example-X.10A",
      code: "X.10A",
      thaiwaterId: 2587,
      name: { th: "สะพานเดชานุชิต", en: null },
      agency: "RID",
      bank: 1.15,
      watch: null,
      series: hourly(-48, -3, (h) => 0.5 + (h + 48) * 0.008),
    },
  ],
  thresholds: [
    { signal: "rain_72h_mm", levels: { watch: 180 }, provisional: true, updatedAt: null },
    {
      signal: "key_level_m",
      levels: { watch: 15.75, warning: 16, evacuate: 16.5 },
      provisional: true,
      updatedAt: null,
    },
    {
      signal: "upstream_level_m",
      levels: { watch: 37.4, warning: 38.15, evacuate: 39.7 },
      provisional: true,
      updatedAt: null,
    },
  ],
  rain: hourly(-72, 120, (h) =>
    h > -40 && h <= 0
      ? 4.5 + 3 * Math.sin(h / 4) ** 2
      : h > 0 && h < 36
        ? 6 + 4 * Math.sin(h / 5) ** 2
        : h >= 36 && h < 60
          ? 1.2
          : 0.1,
  ),
  discharge: Array.from({ length: 14 }, (_, i): Point => [
    EXAMPLE_SIGNALS_NOW + (i - 7) * 24 * HOUR,
    60 + (i > 4 ? (i - 4) * 140 : 0) - (i > 9 ? (i - 9) * 220 : 0),
  ]),
  // Monsoon set-up with the tidal range squeezed: the low water never drops, which is the case
  // the coastal gate is there to show (science plan Module 10).
  tide: hourly(-24, 72, (h) => 1.25 + 0.28 * Math.sin((h / 12.4) * 2 * Math.PI)),
  forecastIssuedAt: EXAMPLE_SIGNALS_NOW - 0.5 * HOUR,
};

const quiet: Zone = {
  id: "00000000-0000-4000-8000-000000000002",
  basin: "kolok",
  name: { th: "แม่น้ำโก-ลก", ms: "Sungai Golok", en: "Kolok River" },
  key: {
    code: "X.119A",
    thaiwaterId: 2559,
    name: { th: "บริเวณสะพานลันตู", en: null },
    agency: "RID",
    bank: 9.3,
    watch: 8.8,
    series: hourly(-96, -9, () => 5.4),
  },
  upstream: null,
  others: [],
  thresholds: [
    { signal: "rain_72h_mm", levels: { watch: 100 }, provisional: true, updatedAt: null },
    {
      signal: "key_level_m",
      levels: { warning: 8.5, evacuate: 9.3 },
      provisional: false,
      updatedAt: EXAMPLE_SIGNALS_NOW - 30 * HOUR,
    },
  ],
  rain: hourly(-72, 120, (h) => (h % 9 === 0 ? 1.4 : 0.1)),
  discharge: Array.from({ length: 14 }, (_, i): Point => [
    EXAMPLE_SIGNALS_NOW + (i - 7) * 24 * HOUR,
    40 + i,
  ]),
  tide: hourly(-24, 72, (h) => 0.8 + 0.5 * Math.sin((h / 12.4) * 2 * Math.PI)),
  forecastIssuedAt: EXAMPLE_SIGNALS_NOW - 0.5 * HOUR,
};

const place = (
  gauge: Zone["key"] | undefined,
  lon: number,
  lat: number,
  zoneId: string,
  auto = false,
) => ({
  ...gauge!,
  id: `example-${gauge!.code}`,
  auto,
  lon,
  lat,
  zoneId,
});

export const EXAMPLE_SIGNALS: Signals = {
  now: EXAMPLE_SIGNALS_NOW,
  zones: [rising, quiet],
  auto: { graceMinutes: 20, maxAgeH: 3, mode: "drill" },
  events: [
    {
      id: "00000000-0000-4000-8000-0000000000e1",
      zoneId: rising.id,
      gauge: "X.40A",
      level: "warning",
      value: 16.2,
      threshold: 16,
      observedAt: EXAMPLE_SIGNALS_NOW - HOUR,
      createdAt: EXAMPLE_SIGNALS_NOW - 0.2 * HOUR,
      deadline: EXAMPLE_SIGNALS_NOW + 0.13 * HOUR,
      status: "pending",
      alertId: null,
    },
  ],
  allGauges: [
    place(rising.key, 101.266294, 6.552798, rising.id, true),
    place(rising.upstream, 101.268219, 6.262033, rising.id),
    place(rising.others[0], 101.252129, 6.866, rising.id),
    place(quiet.key, 101.9749, 6.0226, quiet.id),
    {
      code: "X.44",
      id: "example-X.44",
      thaiwaterId: 2591,
      name: { th: "บ้านหาดใหญ่ใน", en: null },
      agency: "RID",
      bank: 7.4,
      watch: null,
      series: hourly(-48, -1, () => 0.9),
      auto: false,
      lon: 100.4561,
      lat: 7.0022,
      zoneId: null,
    },
  ],
  feeds: {
    gauges: { at: EXAMPLE_SIGNALS_NOW - 0.1 * HOUR, ok: true, error: null },
    signals: { at: EXAMPLE_SIGNALS_NOW - 0.5 * HOUR, ok: true, error: null },
  },
};

/** Made-up rows of `admin_gauge_levels()` for the example page (the real ones come from seed 47). */
export const EXAMPLE_GAUGE_LEVELS = [
  {
    station_id: "example-X.40A",
    watch_m: 15.75,
    warning_m: 16,
    evacuate_m: 16.5,
    provisional: true,
    method: { how: "mixed", floods: 8 },
  },
  {
    station_id: "example-X.77",
    watch_m: 37.4,
    warning_m: 38.15,
    evacuate_m: 39.7,
    provisional: true,
    method: { how: "rise", floods: 2 },
  },
  {
    station_id: "example-X.10A",
    watch_m: 0.85,
    warning_m: 1.05,
    evacuate_m: 1.15,
    provisional: false,
    method: { how: "set by an admin" },
  },
];

/**
 * Made-up rows of `admin_coastal_gate()` for the example page. The percentiles are the shape of
 * the real ones (seed 49), including a mouth with no warning zone, so the example shows both the
 * gate panel and the line that names a mouth Jaga has no live feed for.
 */
/**
 * Season state (Module 11), as `admin_season_signals()`, `admin_season_state()` and
 * `admin_season_notices()` answer. Three zones in three states on purpose: Pattani rising with a
 * wet fortnight behind it (the one that raises a notice), Kolok wet but not rising, and U-Taphao
 * with a gap in its readings, so the example page shows what "we cannot say" looks like.
 */
export const EXAMPLE_SEASON_SIGNALS = {
  now: new Date(EXAMPLE_SIGNALS_NOW).toISOString(),
  zones: [
    {
      zoneId: "00000000-0000-4000-8000-000000000001",
      basin: "pattani_river",
      grade: "rising_wet",
      reasons: ["rising_week", "wet_fortnight"],
      stale: false,
      figures: {
        basin: "pattani_river",
        gauge: "X.40A",
        month: 11,
        at: new Date(EXAMPLE_SIGNALS_NOW).toISOString(),
        floor: {
          m: 13.62,
          at: new Date(EXAMPLE_SIGNALS_NOW - 9 * 3_600_000).toISOString(),
          roseDays: 6,
          change7dM: 0.41,
          band: "high",
          vsNormalM: 0.62,
          reference: { p33: 12.82, p50: 13.0, p67: 13.48, seasons: 7 },
        },
        rain: {
          d15Mm: 268,
          d15Band: "high",
          d30Mm: 402,
          seasonMm: 611,
          seasonBand: "high",
          at: new Date(EXAMPLE_SIGNALS_NOW - 3_600_000).toISOString(),
          reference: { d15: { p33: 131.5, p50: 178.1, p67: 225.3 }, seasons: 9 },
        },
        stale: false,
        blind: [],
        grade: "rising_wet",
        reasons: ["rising_week", "wet_fortnight"],
      },
    },
    {
      zoneId: "00000000-0000-4000-8000-000000000002",
      basin: "kolok",
      grade: "wet",
      reasons: ["wet_fortnight"],
      stale: false,
      figures: {
        basin: "kolok",
        gauge: "X.119A",
        month: 11,
        at: new Date(EXAMPLE_SIGNALS_NOW).toISOString(),
        floor: {
          m: 4.9,
          at: new Date(EXAMPLE_SIGNALS_NOW - 2 * 3_600_000).toISOString(),
          roseDays: 2,
          change7dM: -0.12,
          band: "low",
          vsNormalM: -0.4,
          reference: { p33: 4.89, p50: 5.3, p67: 6.31, seasons: 7 },
        },
        rain: {
          d15Mm: 301,
          d15Band: "high",
          d30Mm: 470,
          seasonMm: 702,
          seasonBand: "high",
          at: new Date(EXAMPLE_SIGNALS_NOW - 3_600_000).toISOString(),
          reference: { d15: { p33: 139.9, p50: 205.7, p67: 283.8 }, seasons: 9 },
        },
        stale: false,
        blind: [],
        grade: "wet",
        reasons: ["wet_fortnight"],
      },
    },
    {
      zoneId: "00000000-0000-4000-8000-000000000003",
      basin: "u_taphao",
      grade: "quiet",
      reasons: [],
      stale: true,
      figures: {
        basin: "u_taphao",
        gauge: "X.44",
        month: 11,
        at: new Date(EXAMPLE_SIGNALS_NOW).toISOString(),
        floor: {
          m: null,
          at: new Date(EXAMPLE_SIGNALS_NOW - 50 * 3_600_000).toISOString(),
          roseDays: null,
          change7dM: null,
          band: "unknown",
          vsNormalM: null,
          reference: { p33: 0.91, p50: 1.13, p67: 1.62, seasons: 7 },
        },
        rain: {
          d15Mm: 120,
          d15Band: "low",
          d30Mm: 260,
          seasonMm: 430,
          seasonBand: "middle",
          at: new Date(EXAMPLE_SIGNALS_NOW - 3_600_000).toISOString(),
          reference: { d15: { p33: 138.7, p50: 160.3, p67: 189.4 }, seasons: 9 },
        },
        stale: true,
        blind: ["gaugeDays"],
        grade: "quiet",
        reasons: [],
      },
    },
  ],
};

export const EXAMPLE_SEASON_STATE = {
  now: new Date(EXAMPLE_SIGNALS_NOW).toISOString(),
  gauges: [10, 11, 12, 1].map((month) => ({
    stationId: "example-X.40A",
    thaiwaterId: 2583,
    code: "X.40A",
    month,
    floor: { p33: 12.59, p50: 12.75, p67: 13.07 },
    rise: { p33: -0.06, p50: 0.05, p67: 0.13 },
    seasons: 7,
    days: 217,
    seaM: 0.018,
    pulseM: 0.118,
    method: { source: "example" },
    updatedAt: "2026-11-10T00:00:00Z",
  })),
  zones: [10, 11, 12, 1].map((month) => ({
    zoneId: "00000000-0000-4000-8000-000000000001",
    basin: "pattani_river",
    month,
    d15: { p33: 131.5, p50: 178.1, p67: 225.3 },
    d30: { p33: 266.3, p50: 318.3, p67: 358.0 },
    std: { p33: 365.1, p50: 432.7, p67: 531.5 },
    seasons: 9,
    days: 183,
    method: { source: "example" },
    updatedAt: "2026-11-10T00:00:00Z",
  })),
};

export const EXAMPLE_SEASON_NOTICES = [
  {
    id: "cccccccc-0000-4000-8000-00000000000c",
    zone_id: "00000000-0000-4000-8000-000000000001",
    basin: "pattani_river",
    raised_at: new Date(EXAMPLE_SIGNALS_NOW - 4 * 3_600_000).toISOString(),
    observed_at: new Date(EXAMPLE_SIGNALS_NOW - 9 * 3_600_000).toISOString(),
    grade: "rising_wet",
    reasons: ["rising_week", "wet_fortnight"],
    figures: EXAMPLE_SEASON_SIGNALS.zones[0]!.figures,
    status: "open",
    reviewed_at: null,
    review_note: null,
    ended_at: null,
  },
];

export const EXAMPLE_COASTAL_GATE = [
  {
    id: "pattani_river",
    basin: "pattani_river",
    name: { th: "ปากแม่น้ำปัตตานี", ms: "Muara Sungai Patani", en: "Pattani River mouth" },
    lat: 6.958,
    lon: 101.292,
    llw_p50: 0.75,
    llw_p90: 0.94,
    llw_p98: 1.1,
    setup_p50: 1.0,
    setup_p90: 1.19,
    setup_p98: 1.3,
    season_days: 450,
    method: { source: "example" },
    updated_at: "2026-10-16T00:00:00Z",
  },
  {
    id: "kolok",
    basin: "kolok",
    name: { th: "ปากแม่น้ำโก-ลก (ตากใบ)", ms: "Muara Sungai Golok (Tak Bai)", en: "Kolok River mouth (Tak Bai)" },
    lat: 6.375,
    lon: 102.125,
    llw_p50: 0.61,
    llw_p90: 0.82,
    llw_p98: 0.99,
    setup_p50: 1.0,
    setup_p90: 1.18,
    setup_p98: 1.29,
    season_days: 450,
    method: { source: "example" },
    updated_at: "2026-10-16T00:00:00Z",
  },
  {
    id: "bang_nara",
    basin: null,
    name: { th: "ปากแม่น้ำบางนรา", ms: "Muara Sungai Bang Nara", en: "Bang Nara River mouth" },
    lat: 6.542,
    lon: 101.875,
    llw_p50: 0.68,
    llw_p90: 0.89,
    llw_p98: 1.03,
    setup_p50: 1.0,
    setup_p90: 1.19,
    setup_p98: 1.29,
    season_days: 450,
    method: { source: "example" },
    updated_at: "2026-10-16T00:00:00Z",
  },
];

/**
 * The reservoirs' panel with made-up figures (27 Oct 2026), so it can be looked at on
 * /dev/signals without an admin session. One near full and still filling, one quiet, one armed
 * with nobody in its zone to warn - the three states the panel has to say something different
 * about.
 */
export const EXAMPLE_DAM_LEVELS: DamLevels[] = [
  {
    code: "khlong_chamrai",
    name: { th: "อ่างเก็บน้ำคลองจำไหร", ms: "Empangan Khlong Chamrai", en: "Khlong Chamrai Reservoir" },
    operator: "RID",
    feed: "daily",
    storageMaxMcm: 6,
    storageNormalMcm: 6,
    nearFullPct: 80,
    fullPct: 95,
    auto: true,
    autoSetAt: "2026-11-19T22:00:00.000Z",
    autoSetBy: null,
    tambons: 1,
    signal: exampleDamSignal("watch")
      ? { ...exampleDamSignal("watch")!, percentFull: 96.1, storageMcm: 5.77, riseMcmPerH: 0.02,
          reasons: ["full_and_rising"], grade: "releasing" }
      : null,
  },
  {
    code: "khlong_sadao",
    name: { th: "อ่างเก็บน้ำคลองสะเดา", ms: "Empangan Khlong Sadao", en: "Khlong Sadao Reservoir" },
    operator: "RID",
    feed: "daily",
    storageMaxMcm: 56.741,
    storageNormalMcm: 56.741,
    nearFullPct: 80,
    fullPct: 95,
    auto: true,
    autoSetAt: "2026-11-19T22:00:00.000Z",
    autoSetBy: "สมชาย",
    tambons: 2,
    signal: exampleDamSignal("quiet")
      ? { ...exampleDamSignal("quiet")!, percentFull: 39.9, storageMcm: 22.66 }
      : null,
  },
  {
    code: "ban_baik",
    name: { th: "อ่างเก็บน้ำบ้านไบก์", ms: "Empangan Ban Baik", en: "Ban Baik Reservoir" },
    operator: "RID",
    feed: "daily",
    storageMaxMcm: 1.2,
    storageNormalMcm: 1.2,
    nearFullPct: null,
    fullPct: null,
    auto: true,
    autoSetAt: "2026-11-19T22:00:00.000Z",
    autoSetBy: null,
    tambons: 0,
    signal: null,
  },
];
