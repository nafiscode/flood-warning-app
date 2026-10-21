import { afterEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import { RAIN_GROUP, RainPeek, RainSection, rainAhead } from "@/components/map/RainCard";
import { SeaPeek } from "@/components/map/Sea";
import { mapMessages } from "@/lib/messages";
import { RAIN_KINDS } from "@/lib/place-rain";
import { COAST_POINTS, type SeaHour } from "@/lib/sea";
import type { Weather } from "@/lib/weather";
import en from "@/messages/en.json";
import th from "@/messages/th.json";
import { renderWithIntl } from "./render";

/**
 * The owner, 15 Oct: a sea point and a rain cloud on the map show their details on hover (a
 * laptop) or a tap (a phone), with a button down to their own section under the map.
 */

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 10, 20, 3);
afterEach(() => vi.unstubAllGlobals());

function seaHours(wave: number): SeaHour[] {
  return Array.from({ length: 40 }, (_, i) => ({
    t: NOW - 6 * HOUR + i * HOUR,
    wave,
    waveFrom: 45,
    period: 5,
    swell: 0.2,
    wind: 12,
    gust: 20,
    code: 3,
    sea: Math.sin(((i - 6) / 12.4) * 2 * Math.PI) * 0.4,
  }));
}

describe("the sea point's pop-up", () => {
  it("says the grade, the waves and the tide, and leads to the Sea and coast section", () => {
    const more = vi.fn();
    const point = { ...COAST_POINTS[3]!, hours: seaHours(2.2) };
    const c = renderWithIntl(<SeaPeek point={point} now={NOW} onMore={more} />, "en").container;
    expect(c.querySelector("[data-peek='sea']")?.getAttribute("data-peek-id")).toBe("pattani");
    expect(c.textContent).toContain("Off Pattani");
    expect(c.textContent).toContain(en.sea.grade.stay.title);
    expect(c.textContent).toContain("Waves 2.2 m");
    expect(c.textContent).toContain(en.sea.tide.rising);
    expect(c.textContent).toContain(en.sea.peekNote);
    c.querySelector<HTMLButtonElement>("[data-peek-more]")!.click();
    expect(more).toHaveBeenCalledOnce();
  });
});

describe("the rain cloud's pop-up", () => {
  it("names the place and what is falling, in the weather widget's words", () => {
    const more = vi.fn();
    const c = renderWithIntl(<RainPeek name="บ้าน" kind="thunder" onMore={more} />).container;
    expect(c.textContent).toContain("บ้าน");
    expect(c.textContent).toContain(th.weather.codes.thunder);
    c.querySelector<HTMLButtonElement>("[data-peek-more]")!.click();
    expect(more).toHaveBeenCalledOnce();
  });

  it("over a reservoir, names the lake and says the rain runs into it", () => {
    const c = renderWithIntl(
      <RainPeek name="เขื่อนบางลาง" kind="heavy" reservoir onMore={vi.fn()} />,
    ).container;
    expect(c.querySelector("[data-peek-reservoir]")).not.toBeNull();
    expect(c.textContent).toContain("เขื่อนบางลาง");
    expect(c.textContent).toContain(th.mapRain.reservoirNote);
    expect(c.textContent).not.toContain(th.mapRain.peekNote);
  });

  it("has a word for every kind of cloud", () => {
    for (const kind of RAIN_KINDS) expect(th.weather.codes[RAIN_GROUP[kind]]).toBeTruthy();
  });
});

function forecast(rain: number[]): Weather {
  return {
    lat: 6.87,
    lon: 101.25,
    timezone: "Asia/Bangkok",
    at: new Date(NOW).toISOString(),
    tempC: 27,
    feelsC: 30,
    humidity: 90,
    rainMm: 3,
    windKmh: 10,
    windFrom: "ne",
    isDay: true,
    code: 63,
    hours: rain.map((mm, i) => ({
      at: new Date(NOW + i * HOUR).toISOString(),
      tempC: 27,
      code: mm > 0 ? 63 : 3,
      rainMm: mm,
      chance: mm > 0 ? 80 : 10,
      isDay: true,
    })),
    days: [],
  };
}

describe("the rain's own section", () => {
  it("finds when the forecast has the rain easing, or says it keeps raining", () => {
    expect(rainAhead(forecast([3, 2, 0, 0, 0, 0, 0]), NOW).easesAt).toBe(
      new Date(NOW + 2 * HOUR).toISOString(),
    );
    const wet = rainAhead(forecast([3, 2, 1, 1, 2, 4, 1, 0]), NOW);
    expect(wet.easesAt).toBeNull();
    expect(wet.hours).toHaveLength(6);
  });

  it("shows the next hours from the forecast, with the model time and what it is not", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(forecast([3, 2, 0, 0, 0, 0])))),
    );
    const c = renderWithIntl(
      <RainSection name="Home" lat={6.871} lon={101.252} kind="rain" now={NOW} />,
      "en",
    ).container;
    await waitFor(() => expect(c.querySelector("[data-rain-hours]")).not.toBeNull());
    expect(c.querySelector("h2")?.textContent).toBe("Rain at Home");
    expect(c.querySelectorAll("[data-rain-hours] li")).toHaveLength(6);
    expect(c.querySelector("[data-rain-eases]")?.getAttribute("data-rain-eases")).toBe("yes");
    expect(c.textContent).toContain(en.mapRain.note);
    expect(c.textContent).toContain("Open-Meteo");
    // The point is rounded to about a kilometre, as the weather page asks.
    expect(vi.mocked(fetch).mock.calls[0]![0]).toBe("/api/public/weather?lat=6.87&lon=101.25");
  });

  it("shows nothing as current from a forecast with no hour ahead", async () => {
    const old = forecast([3, 2, 1]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(old))),
    );
    const c = renderWithIntl(
      <RainSection name="Home" lat={6.87} lon={101.25} kind="rain" now={NOW + 10 * HOUR} />,
    ).container;
    await waitFor(() => expect(c.querySelector("[data-rain-failed]")).not.toBeNull());
    expect(c.querySelector("[data-rain-hours]")).toBeNull();
  });

  it("says so when the forecast cannot be loaded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 503 })),
    );
    const c = renderWithIntl(
      <RainSection name="Home" lat={6.87} lon={101.25} kind="rain" now={NOW} />,
    ).container;
    await waitFor(() => expect(c.querySelector("[data-rain-failed]")).not.toBeNull());
  });

  it("reaches the map page with its words and the weather widget's", () => {
    const sent = mapMessages(en) as Record<string, Record<string, unknown>>;
    expect(sent.mapRain).toBeDefined();
    expect(sent.weather!.codes).toEqual(en.weather.codes);
  });
});
