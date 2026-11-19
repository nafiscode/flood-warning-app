import { describe, expect, it } from "vitest";
import {
  agreement,
  COND_GROUPS,
  FIELDS,
  forecastUrl,
  HOURS,
  QUIET_MM,
  sumRain,
  toForecast,
} from "@/lib/tmd-forecast";
import { WEATHER_GROUPS } from "@/lib/weather";

/**
 * Reading TMD's own forecast model, and comparing it with Open-Meteo's.
 *
 * Most of these tests encode TMD's published documentation. One - "a real answer from TMD" at the
 * end - is a verbatim slice of what the live endpoint actually returned for Pattani on 19 Nov 2026,
 * captured with the owner's token. That one is the test that matters: if TMD changes the shape of
 * its answer, it is the one that goes red. The others keep the reader honest about the shapes TMD's
 * own documentation describes but production does not currently send.
 */

const ANSWER = {
  WeatherForcasts: [
    {
      location: { lat: 6.87, lon: 101.25 },
      forecasts: [
        { time: "2026-11-19T01:00:00+07:00", data: { rain: 0.5, tc: 25.2, cond: 5 } },
        { time: "2026-11-19T02:00:00+07:00", data: { rain: 12.25, tc: 25.0, cond: 7 } },
        { time: "2026-11-19T03:00:00+07:00", data: { rain: 0, tc: 24.8, cond: 2 } },
      ],
    },
  ],
};

describe("the request", () => {
  it("asks for the fields the card uses, at the point, for the next day", () => {
    const url = new URL(forecastUrl(6.87, 101.25));
    expect(url.origin + url.pathname).toBe(
      "https://data.tmd.go.th/nwpapi/v1/forecast/location/hourly/at",
    );
    expect(url.searchParams.get("lat")).toBe("6.87");
    expect(url.searchParams.get("fields")).toBe(FIELDS.join(","));
    expect(url.searchParams.get("duration")).toBe(String(HOURS));
    // No date or hour: TMD then starts from the current hour, which keeps one cached answer
    // valid for every reader near the point.
    expect(url.searchParams.get("date")).toBeNull();
    expect(url.searchParams.get("hour")).toBeNull();
  });

  it("never asks for more hours than TMD allows in one call", () => {
    expect(new URL(forecastUrl(6.87, 101.25, 200)).searchParams.get("duration")).toBe("48");
    expect(new URL(forecastUrl(6.87, 101.25, 0)).searchParams.get("duration")).toBe("1");
  });
});

describe("reading the answer", () => {
  it("reads the hours, their rain and the total", () => {
    const forecast = toForecast(ANSWER)!;
    expect(forecast.lat).toBe(6.87);
    expect(forecast.hours).toHaveLength(3);
    expect(forecast.hours[0]!.rainMm).toBe(0.5);
    expect(forecast.hours[0]!.tempC).toBe(25.2);
    // 0.5 + 12.25 + 0, rounded to a tenth.
    expect(forecast.rainMm).toBe(12.8);
  });

  it("reads TMD's +07:00 hours as the right instants", () => {
    // 01:00 in Bangkok is 18:00 UTC the day before.
    expect(toForecast(ANSWER)!.hours[0]!.at).toBe("2026-11-18T18:00:00.000Z");
  });

  it("maps TMD's condition codes onto groups the app can already say and draw", () => {
    const forecast = toForecast(ANSWER)!;
    expect(forecast.hours[1]!.group).toBe("rainHeavy");
    expect(forecast.hours[2]!.group).toBe("partlyCloudy");
    // Every mapped group must be one the app has words and an icon for in all three languages.
    for (const group of Object.values(COND_GROUPS)) {
      expect(WEATHER_GROUPS).toContain(group);
    }
  });

  it("accepts either spelling of the top-level key, and a bare array", () => {
    // TMD's own documentation shows both; a reader that only knew one would break on the day
    // TMD fixes its typo.
    const inner = ANSWER.WeatherForcasts;
    expect(toForecast({ WeatherForecasts: inner })?.hours).toHaveLength(3);
    expect(toForecast({ WeatherForecast: inner })?.hours).toHaveLength(3);
    expect(toForecast(inner)?.hours).toHaveLength(3);
  });

  it("keeps a measured zero and does not invent a number for a missing field", () => {
    const sparse = {
      WeatherForcasts: [
        {
          location: { lat: 6.87, lon: 101.25 },
          forecasts: [{ time: "2026-11-19T01:00:00+07:00", data: { rain: 0 } }],
        },
      ],
    };
    const forecast = toForecast(sparse)!;
    expect(forecast.hours[0]!.rainMm).toBe(0);
    expect(forecast.hours[0]!.tempC).toBeNull();
    expect(forecast.hours[0]!.group).toBeNull();
  });

  it("skips an hour with no readable time, keeping the rest", () => {
    const mixed = {
      WeatherForcasts: [
        {
          location: { lat: 6.87, lon: 101.25 },
          forecasts: [
            { time: "nonsense", data: { rain: 99 } },
            { time: "2026-11-19T01:00:00+07:00", data: { rain: 1 } },
          ],
        },
      ],
    };
    const forecast = toForecast(mixed)!;
    expect(forecast.hours).toHaveLength(1);
    // The skipped hour's rain must not reach the total either.
    expect(forecast.rainMm).toBe(1);
  });

  it("returns null, never a half-built forecast, for anything it cannot read", () => {
    for (const bad of [
      null,
      undefined,
      "error",
      42,
      {},
      { WeatherForcasts: [] },
      { WeatherForcasts: [{ location: {}, forecasts: [] }] },
      // A location with no coordinates: we would not know what the forecast is for.
      { WeatherForcasts: [{ forecasts: ANSWER.WeatherForcasts[0]!.forecasts }] },
      // An error page served as JSON.
      { message: "Unauthorized" },
    ]) {
      expect(() => toForecast(bad)).not.toThrow();
      expect(toForecast(bad)).toBeNull();
    }
  });
});

describe("summing Open-Meteo's rain over the same hours", () => {
  const HOUR = 3_600_000;
  const from = Date.parse("2026-11-18T18:00:00Z");
  const hours = Array.from({ length: 48 }, (_, i) => ({
    at: new Date(from - 6 * HOUR + i * HOUR).toISOString(),
    rainMm: 1,
  }));

  it("counts only the hours from the same instant, for the same length", () => {
    // Comparing two models over different hours would be worse than not comparing them.
    expect(sumRain(hours, from, 24)).toBe(24);
    expect(sumRain(hours, from, 3)).toBe(3);
  });

  it("is zero when the forecast does not reach those hours", () => {
    expect(sumRain(hours, from + 1000 * HOUR, 24)).toBe(0);
    expect(sumRain([], from, 24)).toBe(0);
  });

  it("ignores an hour with an unreadable time", () => {
    expect(sumRain([{ at: "nope", rainMm: 50 }, ...hours], from, 24)).toBe(24);
  });
});

describe("whether the two models agree", () => {
  it("calls a dry day agreement whatever the small print says", () => {
    // 1 mm against 4 mm is not a disagreement anyone should act on.
    expect(agreement(1, 4)).toBe("agree");
    expect(agreement(0, 0)).toBe("agree");
    expect(agreement(0, QUIET_MM - 0.1)).toBe("agree");
  });

  it("calls close numbers agreement", () => {
    expect(agreement(40, 45)).toBe("agree");
    expect(agreement(20, 25)).toBe("agree");
  });

  it("names a real difference", () => {
    expect(agreement(20, 45)).toBe("differ");
    expect(agreement(45, 20)).toBe("differ");
  });

  it("names a wide gap as wide, whichever model is higher", () => {
    expect(agreement(15, 90)).toBe("farApart");
    expect(agreement(90, 15)).toBe("farApart");
  });

  it("is symmetrical everywhere", () => {
    for (const [a, b] of [
      [0, 0],
      [2, 9],
      [20, 25],
      [20, 60],
      [10, 120],
      [5, 5],
    ]) {
      expect(agreement(a!, b!)).toBe(agreement(b!, a!));
    }
  });
});

/**
 * A real answer, kept verbatim.
 *
 * The first five hours of what `data.tmd.go.th/nwpapi/v1/forecast/location/hourly/at` returned for
 * a point in Pattani on 19 November 2026, with the owner's token - including the key spelling
 * (`WeatherForecasts`), the `+07:00` stamps, and the grid point TMD substitutes for the point asked
 * for (6.8693,101.2502 was requested; 6.8764,101.2447 came back). Nothing here is hand-written: if
 * this test fails, TMD's API has changed, not the test.
 */
const LIVE_ANSWER = {
  WeatherForecasts: [
    {
      location: { lat: 6.8764, lon: 101.2447 },
      forecasts: [
        { time: "2026-11-19T08:00:00+07:00", data: { cond: 3, rain: 0, tc: 24.6 } },
        { time: "2026-11-19T09:00:00+07:00", data: { cond: 4, rain: 0, tc: 27.55 } },
        { time: "2026-11-19T10:00:00+07:00", data: { cond: 4, rain: 0, tc: 29.05 } },
        { time: "2026-11-19T11:00:00+07:00", data: { cond: 4, rain: 0.1, tc: 28.32 } },
        { time: "2026-11-19T12:00:00+07:00", data: { cond: 5, rain: 0.3, tc: 30.08 } },
      ],
    },
  ],
};

describe("a real answer from TMD", () => {
  it("is read whole", () => {
    const forecast = toForecast(LIVE_ANSWER);
    expect(forecast).not.toBeNull();
    expect(forecast!.hours).toHaveLength(5);
    expect(forecast!.hours.every((hour) => hour.rainMm !== null && hour.tempC !== null)).toBe(true);
    // 0 + 0 + 0.1 + 0.3: a measured-looking total, and the zeros must stay zeros, not nulls.
    expect(forecast!.rainMm).toBe(0.4);
    expect(forecast!.hours[0]!.rainMm).toBe(0);
  });

  it("reports the grid point TMD answered for, not the point asked for", () => {
    // The reader must never claim the forecast is for somewhere it is not, even by a kilometre.
    const forecast = toForecast(LIVE_ANSWER)!;
    expect(forecast.lat).toBe(6.8764);
    expect(forecast.lon).toBe(101.2447);
  });

  it("turns TMD's Bangkok hours into instants", () => {
    const forecast = toForecast(LIVE_ANSWER)!;
    // 08:00 +07:00 is 01:00 UTC. Getting this wrong by seven hours would put tonight's rain in
    // this afternoon's card.
    expect(forecast.hours[0]!.at).toBe("2026-11-19T01:00:00.000Z");
  });

  it("maps every condition code the live answer used", () => {
    const forecast = toForecast(LIVE_ANSWER)!;
    expect(forecast.hours.map((hour) => hour.group)).toEqual([
      "partlyCloudy",
      "overcast",
      "overcast",
      "overcast",
      "rainLight",
    ]);
  });

  it("gives an hour TMD skipped no silent substitute", () => {
    // Not something the live answer did - its hours were contiguous - but the reader must not
    // assume they always will be. Hours are read as they come and the card compares the hours it
    // was given, rather than quietly filling a gap with a zero that nobody forecast.
    const gappy = {
      WeatherForecasts: [
        {
          location: { lat: 6.8764, lon: 101.2447 },
          forecasts: [
            LIVE_ANSWER.WeatherForecasts[0]!.forecasts[0]!,
            LIVE_ANSWER.WeatherForecasts[0]!.forecasts[3]!,
          ],
        },
      ],
    };
    const forecast = toForecast(gappy)!;
    expect(forecast.hours.map((hour) => hour.at.slice(11, 16))).toEqual(["01:00", "04:00"]);
    expect(forecast.rainMm).toBe(0.1);
  });
});
