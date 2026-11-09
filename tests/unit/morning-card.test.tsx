import { describe, expect, it } from "vitest";
import { MorningBriefView } from "@/components/home/MorningBrief";
import { morningBrief } from "@/lib/morning-brief";
import { HOUR_MM } from "@/lib/weather-advisory";
import type { Weather, WeatherHour } from "@/lib/weather";
import { SCENE_LOOKS } from "@/lib/weather-scene";
import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import th from "@/messages/th.json";
import { homeMessages } from "@/lib/messages";
import { renderWithIntl } from "./render";

/** 2026-11-08 in Bangkok (UTC+7). */
const day = (hour: number, minute = 0): string =>
  new Date(Date.UTC(2026, 10, 8, hour - 7, minute)).toISOString();

const hour = (localHour: number, rainMm: number, code = 61): WeatherHour => ({
  at: day(localHour),
  tempC: 28,
  code,
  rainMm,
  chance: 80,
  isDay: localHour >= 6 && localHour < 18,
});

const weather = (hours: WeatherHour[], rainMm = 9): Weather => ({
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
  days: [{ date: "2026-11-08", at: day(12), code: 61, maxC: 31.4, minC: 24.2, rainMm, chance: 85 }],
});

const card = (hours: WeatherHour[], now = Date.parse(day(6, 30)), rainMm = 9) => {
  const w = weather(hours, rainMm);
  const brief = morningBrief(w, now)!;
  return renderWithIntl(
    <MorningBriefView
      placeName="ตันหยงลุโละ"
      brief={brief}
      hours={w.hours}
      lat={w.lat}
      lon={w.lon}
      modelIsDay={w.isDay}
      now={now}
    />,
    "en",
  );
};

describe("the morning weather card", () => {
  it("says the day, the temperatures and when rain is expected", () => {
    const { container, getByText } = card([hour(9, 0), hour(14, 4), hour(15, 6)]);
    expect(getByText(/Today's weather in ตันหยงลุโละ/)).toBeTruthy();
    expect(getByText("24–31°")).toBeTruthy();
    expect(getByText(/Rain expected 14:00–16:00/)).toBeTruthy();
    expect(container.querySelector("[data-morning-brief='rain']")).toBeTruthy();
  });

  it("says plainly when no rain is expected", () => {
    const { getByText, container } = card([hour(9, 0), hour(10, 0)]);
    expect(getByText("No rain expected for the rest of today")).toBeTruthy();
    expect(container.querySelector("[data-morning-brief='dry']")).toBeTruthy();
  });

  it("always names the source and the model time, and says it is not an alert", () => {
    const { getByText } = card([hour(9, 2)]);
    expect(getByText(/Forecast by Open-Meteo, model data for 06:00/)).toBeTruthy();
    expect(getByText(/It is not a Jaga flood alert\./)).toBeTruthy();
  });

  it("says heavy rain in words, with the hours, no level and no alert colour", () => {
    const { container, getByText } = card([hour(14, HOUR_MM + 3)]);
    expect(getByText("Heavy rain is forecast 14:00–15:00")).toBeTruthy();
    expect(getByText(/allow extra time and avoid the heaviest hours/)).toBeTruthy();
    expect(container.querySelector("[data-brief-severe='heavy_rain']")).toBeTruthy();
    // An alert level is shown by icon + text + colour; this card carries none of the three.
    expect(container.textContent).not.toMatch(/watch|warning|evacuate/i);
    const painted = container.innerHTML;
    for (const alertHue of ["#B45309", "#B91C1C", "#F59E0B", "#DC2626", "#991B1B"]) {
      expect(painted.toUpperCase()).not.toContain(alertHue);
    }
  });

  it("paints a sky, in the weather palette and nothing else", () => {
    const { container } = card([hour(14, 6)]);
    const sky = container.querySelector("[data-brief-sky]")!;
    const scene = sky.getAttribute("data-brief-sky")!;
    expect(Object.keys(SCENE_LOOKS)).toContain(scene);
    // Rain this afternoon, so the card shows a sky with rain falling in it even on a bright
    // morning: the card is about the day, not about this minute.
    const look = SCENE_LOOKS[scene as keyof typeof SCENE_LOOKS];
    expect(look.drops ?? look.glass).toBeTruthy();
  });

  it("suggests an umbrella on an ordinary wet day, and nothing on a dry one", () => {
    const wet = card([hour(14, 4), hour(15, 3)]);
    expect(wet.getByText(/take an umbrella or a raincoat/)).toBeTruthy();
    const dry = card([hour(9, 0), hour(10, 0)], Date.parse(day(6, 30)), 0);
    expect(dry.container.querySelector("[data-brief-advice]")).toBeNull();
  });

  it("on a day of rain, says it rains on and off and names the heaviest hours", () => {
    const allDay = [
      ...[6, 7, 8, 9, 10, 11, 12, 13].map((h) => hour(h, 2)),
      hour(14, 8),
      hour(15, 9),
      ...[16, 17, 18, 19, 20].map((h) => hour(h, 2)),
    ];
    const { container, getByText } = card(allDay, Date.parse(day(6, 30)), 40);
    expect(getByText("Rain on and off for most of the day")).toBeTruthy();
    expect(getByText("Heaviest around 13:00–16:00")).toBeTruthy();
    expect(container.querySelector("[data-brief-heaviest]")).toBeTruthy();
  });

  it("offers the full forecast, one tap away", () => {
    const { container } = card([hour(14, 6)]);
    const link = container.querySelector("[data-brief-open]")!;
    expect(link.getAttribute("href")).toContain("/weather");
  });

  it("shows an old reading as old, never as now", () => {
    // Four hours after the model time: past the three hours lib/weather calls stale.
    const { getByText } = card([hour(14, 6)], Date.parse(day(10)));
    expect(getByText(/more than 3 hours old/)).toBeTruthy();
  });
});

/**
 * The home page sends the browser only the texts it needs (lib/messages.ts, slow-3G budget), so
 * a card whose words are not in that list renders its key names instead of Thai. This renders
 * the card with exactly what the home page sends, and nothing else.
 */
describe("the card's words reach the home screen", () => {
  it("says Thai, not key names, with only the home page's messages", () => {
    const w = weather([hour(14, 6)]);
    const now = Date.parse(day(10)); // past the three hours that make a reading old
    const { container } = render(
      <NextIntlClientProvider
        locale="th"
        messages={homeMessages(th)}
        timeZone="Asia/Bangkok"
      >
        <MorningBriefView
          placeName="ตันหยงลุโละ"
          brief={morningBrief(w, now)!}
          hours={w.hours}
          lat={w.lat}
          lon={w.lon}
          modelIsDay={w.isDay}
          now={now}
        />
      </NextIntlClientProvider>,
    );
    const said = container.textContent ?? "";
    expect(said).not.toMatch(/(brief|weather)\.[a-zA-Z]/);
    expect(said).toContain("ตันหยงลุโละ");
  });
});
