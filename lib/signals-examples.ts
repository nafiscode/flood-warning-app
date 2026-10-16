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
