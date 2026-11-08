import { describe, expect, it } from "vitest";
import { knocksFor, readPayload, weatherPayload, type WeatherDueRow } from "@/lib/push";
import { dayPart, morningBrief, rainWindows, worseGroup } from "@/lib/morning-brief";
import {
  advisoriesFor,
  aheadOf,
  GUST_KMH,
  HOUR_MM,
  pickAdvisory,
  SIX_HOUR_MM,
} from "@/lib/weather-advisory";
import { hoursOf, issuedAtOf } from "@/lib/weather-advisory-server";
import type { Weather, WeatherHour } from "@/lib/weather";
import en from "@/messages/en.json";
import ms from "@/messages/ms.json";
import th from "@/messages/th.json";

/** 2026-11-08, Bangkok (UTC+7): 00:00 local is 17:00 UTC the day before. */
const day = (hour: number, minute = 0): string =>
  new Date(Date.UTC(2026, 10, 8, hour - 7, minute)).toISOString();

const hour = (localHour: number, rainMm: number, code = 61, chance = 80): WeatherHour => ({
  at: day(localHour),
  tempC: 28,
  code,
  rainMm,
  chance,
  isDay: localHour >= 6 && localHour < 18,
});

const weather = (hours: WeatherHour[], rainMm = 12): Weather => ({
  lat: 6.87,
  lon: 101.25,
  timezone: "Asia/Bangkok",
  at: day(6),
  tempC: 27,
  feelsC: 30,
  humidity: 86,
  rainMm: 0,
  windKmh: 9,
  windFrom: "ne",
  isDay: true,
  code: 3,
  hours,
  days: [
    { date: "2026-11-08", at: day(12), code: 61, maxC: 31.4, minC: 24.2, rainMm, chance: 85 },
    { date: "2026-11-09", at: day(36), code: 3, maxC: 32, minC: 25, rainMm: 0, chance: 10 },
  ],
});

describe("the hours rain is expected", () => {
  it("names one spell per run of wet hours", () => {
    const spells = rainWindows([hour(13, 0), hour(14, 2), hour(15, 6), hour(16, 0), hour(17, 0)]);
    expect(spells).toHaveLength(1);
    expect(spells[0]!.from).toBe(day(14));
    // The end is the end of the last wet hour, so 15:00 rain reads as "until 16:00".
    expect(spells[0]!.to).toBe(day(16));
    expect(spells[0]!.peakMm).toBe(6);
    expect(spells[0]!.totalMm).toBe(8);
  });

  it("keeps one dry hour inside a spell, and splits on two", () => {
    expect(rainWindows([hour(10, 3), hour(11, 0), hour(12, 4)])).toHaveLength(1);
    expect(rainWindows([hour(10, 3), hour(11, 0), hour(12, 0), hour(13, 4)])).toHaveLength(2);
  });

  it("reads a trace of rain as a dry hour", () => {
    expect(rainWindows([hour(10, 0.05), hour(11, 0.02)])).toHaveLength(0);
  });

  it("shows a spell with one thundery hour as thundery", () => {
    const spells = rainWindows([hour(14, 3, 61), hour(15, 5, 95)]);
    expect(spells[0]!.group).toBe("thunder");
    expect(worseGroup("rainLight", "thunder")).toBe("thunder");
  });
});

describe("today's brief", () => {
  it("speaks only of the hours still ahead", () => {
    const b = morningBrief(weather([hour(6, 5), hour(7, 0), hour(15, 4)]), Date.parse(day(14)))!;
    // The 06:00 rain has fallen; only the 15:00 spell is left.
    expect(b.windows).toHaveLength(1);
    expect(b.windows[0]!.from).toBe(day(15));
    expect(b.dry).toBe(false);
  });

  it("counts the hour in progress as ahead", () => {
    const b = morningBrief(weather([hour(14, 6)]), Date.parse(day(14, 20)))!;
    expect(b.windows).toHaveLength(1);
  });

  it("says a dry rest of the day when nothing is forecast", () => {
    const b = morningBrief(weather([hour(18, 0), hour(19, 0)], 0), Date.parse(day(17)))!;
    expect(b.dry).toBe(true);
    expect(b.windows).toEqual([]);
  });

  it("carries the day's figures and the model time, never a level", () => {
    const b = morningBrief(weather([hour(9, 4)]), Date.parse(day(6, 30)))!;
    expect(b.maxC).toBe(31.4);
    expect(b.minC).toBe(24.2);
    expect(b.rainMm).toBe(12);
    expect(b.issuedAt).toBe(day(6));
    expect(Object.keys(b)).not.toContain("level");
  });

  it("names at most two spells and says there are more", () => {
    const b = morningBrief(
      // Two dry hours between each: three separate spells, of which two are named.
      weather([hour(8, 3), hour(11, 3), hour(14, 3)]),
      Date.parse(day(7)),
    )!;
    expect(b.windows).toHaveLength(2);
    expect(b.more).toBe(true);
  });

  it("knows where in the day the reader is, in the place's own clock", () => {
    expect(dayPart(Date.parse(day(6, 30)), "Asia/Bangkok")).toBe("morning");
    expect(dayPart(Date.parse(day(14)), "Asia/Bangkok")).toBe("afternoon");
    expect(dayPart(Date.parse(day(20)), "Asia/Bangkok")).toBe("evening");
  });

  it("is nothing at all without a forecast", () => {
    expect(morningBrief(null, Date.now())).toBeNull();
  });
});

describe("severe weather worth a notification", () => {
  const ahead = (hours: WeatherHour[], gusts: (number | null)[] = []) =>
    aheadOf(hours, Date.parse(day(6)), gusts);

  it("finds one very wet hour", () => {
    const found = advisoriesFor(ahead([hour(7, 2), hour(8, HOUR_MM + 1), hour(9, 3)]));
    const rain = found.find((a) => a.kind === "heavy_rain")!;
    expect(rain.startsAt).toBe(day(8));
    expect(rain.peak).toBe(HOUR_MM + 1);
  });

  it("finds a half-day that adds up to a soaking", () => {
    const each = SIX_HOUR_MM / 6 + 0.5;
    const found = advisoriesFor(ahead([7, 8, 9, 10, 11, 12].map((h) => hour(h, each))));
    expect(found.map((a) => a.kind)).toContain("heavy_rain");
  });

  it("leaves an ordinary shower alone", () => {
    expect(advisoriesFor(ahead([hour(7, 2), hour(8, 3), hour(9, 1)]))).toEqual([]);
  });

  it("believes a thunderstorm only when the model half does", () => {
    expect(advisoriesFor(ahead([hour(9, 2, 95, 80)])).map((a) => a.kind)).toContain("thunder");
    expect(advisoriesFor(ahead([hour(9, 2, 95, 20)])).map((a) => a.kind)).not.toContain("thunder");
  });

  it("finds strong wind from the gust, and quotes the strongest", () => {
    const found = advisoriesFor(
      ahead([hour(7, 0, 3), hour(8, 0, 3)], [GUST_KMH + 2, GUST_KMH + 9]),
    );
    const wind = found.find((a) => a.kind === "wind")!;
    expect(wind.peak).toBe(GUST_KMH + 9);
    expect(wind.startsAt).toBe(day(7));
  });

  it("reads no further than half a day ahead", () => {
    const far = [...Array(20)].map((_, i) => hour(7 + i, HOUR_MM + 2));
    expect(ahead(far)).toHaveLength(12);
  });

  it("sends one notification, the most serious", () => {
    const found = advisoriesFor(ahead([hour(8, HOUR_MM + 1, 95, 90)], [GUST_KMH + 5]));
    expect(found).toHaveLength(3);
    expect(pickAdvisory(found)!.kind).toBe("heavy_rain");
    expect(pickAdvisory([])).toBeNull();
  });
});

describe("Open-Meteo's hourly answer", () => {
  const raw = {
    utc_offset_seconds: 25200,
    hourly: {
      time: ["2026-11-08T07:00", "2026-11-08T08:00"],
      precipitation: [1.5, null],
      precipitation_probability: [70, 30],
      weather_code: [61, null],
      wind_gusts_10m: [22.5, null],
    },
  };

  it("turns the place's local times into real instants", () => {
    const hours = hoursOf(raw);
    expect(hours[0]!.hour.at).toBe(day(7));
    expect(hours[0]!.hour.rainMm).toBe(1.5);
    expect(hours[0]!.gustKmh).toBe(22.5);
    expect(issuedAtOf(hours)).toBe(day(7));
  });

  it("treats a missing figure as nothing, never as a guess", () => {
    const hours = hoursOf(raw);
    expect(hours[1]!.hour.rainMm).toBe(0);
    expect(hours[1]!.hour.code).toBeNull();
    expect(hours[1]!.gustKmh).toBeNull();
  });
});

describe("the severe-weather notification", () => {
  const row: WeatherDueRow = {
    advisory_id: "6f9e1a00-0000-4000-8000-000000000001",
    kind: "heavy_rain",
    locale: "th",
    tambon_th: "ตันหยงลุโละ",
    tambon_en: "Tanyong Lulo",
    starts_at: day(14),
    ends_at: day(17),
    peak: 18.4,
    total_mm: 46.2,
    issued_at: day(6),
  };
  const words = (locale: "th" | "ms" | "en") =>
    ({ th: th.push.weather, ms: ms.push.weather, en: en.push.weather })[locale];

  it("says what is expected, when, and where it comes from", () => {
    const p = weatherPayload(row, words("th"))!;
    expect(p.kind).toBe("weather");
    expect(p.title).toContain("ตันหยงลุโละ");
    expect(p.body).toContain("14:00");
    expect(p.body).toContain("17:00");
    expect(p.body).toContain("18");
    expect(p.body).toContain("Open-Meteo");
    expect(p.url).toBe("/weather");
    expect(p.tag).toBe(`weather-${row.advisory_id}`);
  });

  it("is never sticky and never knocks twice: it is weather, not an alarm", () => {
    const p = weatherPayload(row, words("en"))!;
    expect(p.sticky).toBe(false);
    expect(knocksFor(p)).toBeNull();
    // And it carries no level, so nothing can read it as an alert (safety rule 2).
    expect(p).not.toHaveProperty("level");
    expect(readPayload({ ...p })!.kind).toBe("weather");
  });

  it("speaks the phone's language, and the place in it", () => {
    expect(weatherPayload({ ...row, locale: "en" }, words("en"))!.title).toContain("Tanyong Lulo");
    expect(weatherPayload({ ...row, locale: "ms" }, words("ms"))!.body).toContain("Open-Meteo");
  });

  it("has words for each kind, in all three languages, that say it is not an alert", () => {
    for (const locale of ["th", "ms", "en"] as const) {
      for (const kind of ["heavy_rain", "thunder", "wind"] as const) {
        const p = weatherPayload({ ...row, kind, locale }, words(locale))!;
        expect(p, `${locale}/${kind}`).not.toBeNull();
        expect(p.body).toContain("Open-Meteo");
        expect(p.body.length).toBeLessThanOrEqual(241);
      }
    }
  });

  it("is nothing for a kind of weather Jaga does not send", () => {
    expect(weatherPayload({ ...row, kind: "fog" }, words("th"))).toBeNull();
  });
});
