import { describe, expect, it, vi } from "vitest";
import { WeatherView } from "@/components/weather/WeatherView";
import { BANA, EXAMPLE_NOW, EXAMPLE_WEATHER, EXAMPLE_WEATHER_PLACE } from "@/lib/dev-examples";
import th from "@/messages/th.json";
import {
  compass,
  dayOffset,
  localDate,
  forecastUrl,
  geocodeUrl,
  isStale,
  isWet,
  localToIso,
  peakRain,
  placeDetail,
  roundCoord,
  toPlaces,
  toWeather,
  WEATHER_GROUPS,
  weatherGroup,
} from "@/lib/weather";
import { renderWithIntl } from "./render";

describe("weather codes", () => {
  it("names every WMO code Open-Meteo sends", () => {
    expect(weatherGroup(0)).toBe("clear");
    expect(weatherGroup(2)).toBe("partlyCloudy");
    expect(weatherGroup(45)).toBe("fog");
    expect(weatherGroup(53)).toBe("drizzle");
    expect(weatherGroup(65)).toBe("rainHeavy");
    expect(weatherGroup(82)).toBe("showersHeavy");
    expect(weatherGroup(95)).toBe("thunder");
    expect(weatherGroup(99)).toBe("thunderHail");
  });

  it("never calls an unknown or missing code clear sky", () => {
    for (const code of [null, undefined, -1, 7, 1000, Number.NaN]) {
      expect(weatherGroup(code)).toBe("overcast");
    }
  });

  it("has Thai, Malay and English words for every group", () => {
    for (const group of WEATHER_GROUPS) {
      expect(th.weather.codes[group as keyof typeof th.weather.codes]).toBeTruthy();
    }
  });

  it("knows which groups mean rain", () => {
    expect(isWet("rain")).toBe(true);
    expect(isWet("thunder")).toBe(true);
    expect(isWet("partlyCloudy")).toBe(false);
  });
});

describe("compass", () => {
  it("turns degrees into the eight points", () => {
    expect(compass(0)).toBe("n");
    expect(compass(22)).toBe("n");
    expect(compass(23)).toBe("ne");
    expect(compass(46)).toBe("ne");
    expect(compass(180)).toBe("s");
    expect(compass(359)).toBe("n");
    expect(compass(-45)).toBe("nw");
    expect(compass(null)).toBeNull();
  });
});

describe("positions sent to Open-Meteo", () => {
  it("rounds to about 1 km, so no exact position leaves the server", () => {
    expect(roundCoord(6.878213)).toBe(6.88);
    expect(roundCoord(101.271914)).toBe(101.27);
    const url = new URL(forecastUrl(6.878213, 101.271914));
    expect(url.searchParams.get("latitude")).toBe("6.88");
    expect(url.searchParams.get("longitude")).toBe("101.27");
  });

  it("asks for 48 hours, 7 days and the place's own time zone", () => {
    const url = new URL(forecastUrl(6.88, 101.27));
    expect(url.searchParams.get("forecast_hours")).toBe("48");
    expect(url.searchParams.get("forecast_days")).toBe("7");
    expect(url.searchParams.get("timezone")).toBe("auto");
  });

  it("sends only a name and a language when searching for a place", () => {
    const url = new URL(geocodeUrl("ปัตตานี", "th"));
    expect(url.searchParams.get("name")).toBe("ปัตตานี");
    expect(url.searchParams.get("language")).toBe("th");
    expect([...url.searchParams.keys()].sort()).toEqual(["count", "format", "language", "name"]);
  });
});

describe("local times become real instants", () => {
  it("reads Open-Meteo's zone-less times with the offset it gives", () => {
    // 05:30 in Bangkok (UTC+7) is 22:30 the day before in UTC.
    expect(localToIso("2026-10-09T05:30", 25200)).toBe("2026-10-08T22:30:00.000Z");
    expect(localToIso("2026-10-09T05:30", 0)).toBe("2026-10-09T05:30:00.000Z");
  });

  it("survives a time it cannot read", () => {
    expect(localToIso("not a time", 25200)).toBe("1970-01-01T00:00:00.000Z");
  });
});

const RAW = {
  latitude: 6.8541303,
  longitude: 101.221565,
  utc_offset_seconds: 25200,
  timezone: "Asia/Bangkok",
  current: {
    time: "2026-10-09T05:30",
    temperature_2m: 24.8,
    apparent_temperature: 30.3,
    relative_humidity_2m: 98,
    precipitation: 0.4,
    weather_code: 3,
    wind_speed_10m: 6.2,
    wind_direction_10m: 165,
    is_day: 0,
  },
  hourly: {
    time: ["2026-10-09T05:00", "2026-10-09T06:00", "2026-10-09T07:00"],
    temperature_2m: [25, 24.8, null],
    precipitation_probability: [14, 9, null],
    precipitation: [0.1, null, -0.2],
    weather_code: [51, 51, 3],
    is_day: [0, 1, 1],
  },
  daily: {
    time: ["2026-10-09", "2026-10-10"],
    weather_code: [53, 80],
    temperature_2m_max: [30.3, 30.3],
    temperature_2m_min: [24.8, 24.6],
    precipitation_sum: [2.2, 4.6],
    precipitation_probability_max: [97, 99],
  },
};

describe("reading Open-Meteo's answer", () => {
  const weather = toWeather(RAW)!;

  it("keeps what the screens show, with instants and the place's zone", () => {
    expect(weather.timezone).toBe("Asia/Bangkok");
    expect(weather.at).toBe("2026-10-08T22:30:00.000Z");
    expect(weather.tempC).toBe(24.8);
    expect(weather.humidity).toBe(98);
    // 165 degrees is nearer due south than south-east.
    expect(weather.windFrom).toBe("s");
    expect(weather.isDay).toBe(false);
    expect(weather.lat).toBe(6.85);
  });

  it("passes a missing number on as null instead of a wrong number", () => {
    expect(weather.hours[2]!.tempC).toBeNull();
    expect(weather.hours[2]!.chance).toBeNull();
  });

  it("never reports negative rain, and treats a missing amount as none", () => {
    expect(weather.hours[1]!.rainMm).toBe(0);
    expect(weather.hours[2]!.rainMm).toBe(0);
  });

  it("gives every day a midday instant, so the weekday is right", () => {
    expect(weather.days[0]!.at).toBe("2026-10-09T05:00:00.000Z");
    expect(weather.days).toHaveLength(2);
  });

  it("answers null when there are no current conditions at all", () => {
    expect(toWeather({})).toBeNull();
    expect(toWeather({ current: { temperature_2m: 24 } })).toBeNull();
  });
});

describe("reading Open-Meteo's place search", () => {
  it("keeps the name, the area, the country and a rounded point", () => {
    const places = toPlaces({
      results: [
        {
          name: "ปัตตานี",
          latitude: 6.86814,
          longitude: 101.25009,
          admin1: "จังหวัดปัตตานี",
          country: "ไทย",
          country_code: "TH",
        },
        { name: "broken", latitude: 1 },
      ],
    });
    expect(places).toHaveLength(1);
    expect(places[0]).toEqual({
      name: "ปัตตานี",
      area: "จังหวัดปัตตานี",
      country: "ไทย",
      countryCode: "TH",
      lat: 6.87,
      lon: 101.25,
      from: "search",
    });
  });

  it("takes no results as an empty list, not an error", () => {
    expect(toPlaces({})).toEqual([]);
    expect(toPlaces(null)).toEqual([]);
  });

  it("does not repeat the name under the name", () => {
    expect(placeDetail({ ...EXAMPLE_WEATHER_PLACE, name: "ปัตตานี", area: "ปัตตานี" })).toBe("");
  });
});

describe("old readings", () => {
  it("is stale after three hours, and with no time at all", () => {
    const at = "2026-11-20T09:30:00Z";
    expect(isStale(at, Date.parse(at) + 2 * 3_600_000)).toBe(false);
    expect(isStale(at, Date.parse(at) + 4 * 3_600_000)).toBe(true);
    expect(isStale(null, Date.now())).toBe(true);
  });

  it("scales the rain bars to the wettest hour, and never divides by zero", () => {
    expect(peakRain([{ rainMm: 0 } as never, { rainMm: 0 } as never])).toBe(1);
    expect(peakRain([{ rainMm: 0.4 } as never, { rainMm: 7.2 } as never])).toBe(7.2);
  });
});

describe("the day a time falls on at the place", () => {
  it("reads the calendar date in the place's own zone, not the reader's", () => {
    // 23:30 UTC on 8 October is already 06:30 on the 9th in Bangkok.
    expect(localDate("2026-10-08T23:30:00.000Z", "Asia/Bangkok")).toBe("2026-10-09");
    expect(localDate("2026-10-08T23:30:00.000Z", "UTC")).toBe("2026-10-08");
  });

  it("counts whole days, so the chart's axis can say today, tomorrow or the day after", () => {
    const start = "2026-10-08T23:30:00.000Z"; // 06:30 in Bangkok
    const hours = (n: number) => new Date(Date.parse(start) + n * 3_600_000).toISOString();
    expect(dayOffset(hours(0), start, "Asia/Bangkok")).toBe(0);
    expect(dayOffset(hours(17), start, "Asia/Bangkok")).toBe(0);
    expect(dayOffset(hours(18), start, "Asia/Bangkok")).toBe(1); // past local midnight
    expect(dayOffset(hours(24), start, "Asia/Bangkok")).toBe(1);
    expect(dayOffset(hours(47), start, "Asia/Bangkok")).toBe(2);
  });

  it("counts calendar days, not 24-hour blocks", () => {
    // 23:00 local plus two hours is the next day, an hour later, not a day later.
    const late = "2026-10-09T16:00:00.000Z"; // 23:00 in Bangkok
    const after = "2026-10-09T18:00:00.000Z"; // 01:00 the next day
    expect(dayOffset(after, late, "Asia/Bangkok")).toBe(1);
    expect(dayOffset(late, late, "Asia/Bangkok")).toBe(0);
  });

  it("says nothing rather than something wrong when a time cannot be read", () => {
    expect(dayOffset("rubbish", "2026-10-09T00:00:00.000Z", "Asia/Bangkok")).toBeNull();
    expect(localDate("rubbish", "Asia/Bangkok")).toBe("");
  });
});

function view(more: Partial<Parameters<typeof WeatherView>[0]> = {}) {
  return renderWithIntl(
    <WeatherView
      ready
      place={EXAMPLE_WEATHER_PLACE}
      detail={null}
      weather={EXAMPLE_WEATHER}
      fetchedAt={EXAMPLE_NOW - 60_000}
      failed={false}
      now={EXAMPLE_NOW}
      picking={false}
      onPick={() => {}}
      onChoose={() => {}}
      onCancelPick={() => {}}
      onRetry={() => {}}
      {...more}
    />,
  ).container;
}

describe("the weather page", () => {
  it("says it is a forecast, not a Jaga alert, and names its source (safety rule 8)", () => {
    const c = view();
    expect(c.textContent).toContain(th.weather.notAnAlert);
    expect(c.textContent).toContain(th.weather.coverage);
    expect(c.textContent).toContain(th.attribution.openMeteo);
    // The time the model data is for, not just "now".
    expect(c.textContent).toMatch(/ข้อมูลของเวลา/);
  });

  it("carries no alert level, badge or alert colour (safety rules 3 and 10)", () => {
    const c = view();
    expect(c.querySelector("[data-level]")).toBeNull();
    expect(c.innerHTML).not.toMatch(/alert-(normal|watch|warning|evacuate|return)/);
  });

  it("has a way back to the home screen at the top and at the bottom", () => {
    const back = [...view().querySelectorAll('[data-weather-back="true"]')];
    expect(back).toHaveLength(2);
    for (const link of back) {
      expect(link.getAttribute("href")).toBe("/");
      expect(link.textContent).toContain(th.weather.backHome);
    }
  });

  it("shows now, 48 hours of rain, 24 hours and 7 days", () => {
    const c = view();
    expect(c.querySelector('[data-weather-now="true"]')!.textContent).toContain("27°C");
    expect(c.querySelectorAll('[data-weather-rain="true"] [role="img"] span')).toHaveLength(48);
    expect(c.querySelectorAll('[data-weather-hours="true"] li')).toHaveLength(24);
    expect(c.querySelectorAll('[data-weather-days="true"] li')).toHaveLength(7);
    expect(c.querySelector('[data-weather-days="true"]')!.textContent).toContain(
      th.weather.days.today,
    );
  });

  it("names the day under each time on the 48-hour axis", () => {
    const axis = view().querySelector('[data-weather-rain="true"]')!.textContent!;
    expect(axis).toContain(th.weather.days.today);
    expect(axis).toContain(th.weather.days.tomorrow);
    expect(axis).toContain(th.weather.days.dayAfter);
  });

  it("writes every condition out in words, never the icon alone", () => {
    const hours = view().querySelector('[data-weather-hours="true"]')!;
    for (const cell of hours.querySelectorAll("li")) {
      expect(cell.querySelector(".sr-only")!.textContent).toBeTruthy();
      expect(cell.querySelector("svg")).not.toBeNull();
    }
  });

  it("asks for a place when none is known yet", () => {
    const c = view({ place: null, weather: null });
    expect(c.querySelector('[data-weather-picker="true"]')).not.toBeNull();
    expect(c.textContent).toContain(th.weather.place.useGps);
    expect(c.textContent).toContain(th.weather.place.searchLabel);
    // Even with nothing chosen, the way home is there.
    expect(c.querySelectorAll('[data-weather-back="true"]').length).toBeGreaterThan(0);
  });

  it("with no connection shows the last reading with the time it is for", () => {
    const c = view({ failed: true });
    expect(c.querySelector('[data-weather-now="true"]')).not.toBeNull();
    expect(c.textContent).toMatch(/เชื่อมต่อไม่ได้/);
  });

  it("offers another try when there is nothing stored and the request failed", () => {
    const c = view({ weather: null, failed: true });
    expect(c.textContent).toContain(th.weather.unavailable);
    expect(c.textContent).toContain(th.weather.retry);
  });
});

describe("the chip in the header", () => {
  it("shows the temperature and says the condition and place in words", async () => {
    vi.resetModules();
    // The chip reads the phone's storage; the link and the path come from next-intl's navigation.
    window.localStorage.setItem("jaga.area", JSON.stringify(BANA));
    window.localStorage.setItem(
      "jaga.weather.reading",
      JSON.stringify({
        key: `${roundCoord(BANA.lat)},${roundCoord(BANA.lon)}`,
        weather: EXAMPLE_WEATHER,
        fetchedAt: EXAMPLE_NOW,
      }),
    );
    vi.doMock("@/i18n/navigation", () => ({
      Link: ({ href, children, ...rest }: Record<string, unknown> & { children?: unknown }) => (
        <a href={String(href)} {...rest}>
          {children as never}
        </a>
      ),
      usePathname: () => "/",
    }));
    const { WeatherChip } = await import("@/components/weather/WeatherChip");
    const c = renderWithIntl(<WeatherChip />).container;
    const link = c.querySelector("a")!;
    expect(link.getAttribute("href")).toBe("/weather");
    expect(link.textContent).toContain("27°");
    expect(link.getAttribute("aria-label")).toContain(th.weather.codes.rainHeavy);
    expect(link.getAttribute("aria-label")).toContain(BANA.nameTh);
    window.localStorage.clear();
    vi.doUnmock("@/i18n/navigation");
  });
});
