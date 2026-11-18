import { describe, expect, it } from "vitest";
import { isHeavy, rainSoon, SOON_HOURS, type WeatherHour } from "@/lib/weather";

/*
 * The one forward-looking figure in the app's resident screens (the owner, 18 Nov 2026: "Heavy
 * rain is expected in your area in the next 3 hours").
 *
 * Two promises are tested before any arithmetic. **It never invents a severity**: the word
 * "heavy" comes from Open-Meteo's own weather code and never from a number of millimetres we
 * chose, because choosing one would be Jaga asserting a judgement nobody measured (safety
 * rule 8). And **it never reports a dry future it did not read**: where no hour ahead is in the
 * kept reading it answers null, which the screens say nothing about, rather than zero, which
 * they would say was dry (safety rule 10).
 */

const T0 = Date.parse("2026-11-20T06:00:00.000Z");

/** An hour of the kept forecast. 61 is Open-Meteo's light rain, 65 heavy, 95 a thunderstorm. */
const hour = (
  h: number,
  rainMm: number,
  code: number,
  chance: number | null = null,
): WeatherHour => ({
  at: new Date(T0 + h * 3_600_000).toISOString(),
  tempC: 27,
  code,
  rainMm,
  chance,
  isDay: true,
});

describe("the rain the model puts in the hours just ahead", () => {
  it("looks three hours ahead, and no further", () => {
    expect(SOON_HOURS).toBe(3);
    const ahead = [hour(1, 2, 61), hour(2, 3, 61), hour(3, 5, 61), hour(4, 99, 65)];
    const soon = rainSoon(ahead, T0);
    expect(soon?.mm).toBe(10);
    expect(soon?.hours).toBe(3);
  });

  it("leaves out the hour in progress: rain that has fallen is not rain to come", () => {
    expect(rainSoon([hour(0, 50, 65), hour(1, 1, 61)], T0)?.mm).toBe(1);
  });

  it("answers null when no hour ahead was read, which is not a dry forecast", () => {
    expect(rainSoon([hour(-2, 0, 2), hour(0, 0, 2)], T0)).toBeNull();
    expect(rainSoon([], T0)).toBeNull();
  });

  /*
   * `useNow()` is 0 in the server's HTML and until the clock reaches the page. A forecast worked
   * out from the epoch would be a claim about January 1970 printed as a claim about tonight.
   */
  it("claims nothing before the page has a clock", () => {
    expect(rainSoon([hour(1, 40, 65)], 0)).toBeNull();
  });

  it("lets the wettest hour name the whole stretch", () => {
    // A quiet hour, then a thunderstorm: the forecast is the thunderstorm.
    expect(rainSoon([hour(1, 1, 61), hour(2, 20, 95)], T0)?.group).toBe("thunder");
    expect(rainSoon([hour(1, 0, 2), hour(2, 2, 61)], T0)?.group).toBe("rainLight");
    // Nothing wet at all: the words are still the sky's, and `wet` is what the screens read.
    expect(rainSoon([hour(1, 0, 2)], T0)?.wet).toBe(false);
  });

  it("takes the word heavy from the model's code and never from a figure of ours", () => {
    expect(rainSoon([hour(1, 1, 65)], T0)?.heavy).toBe(true);
    // Thirty millimetres under a light-rain code is still not ours to call heavy.
    expect(rainSoon([hour(1, 30, 61)], T0)?.heavy).toBe(false);
    expect(isHeavy("thunder")).toBe(true);
    expect(isHeavy("showersHeavy")).toBe(true);
    expect(isHeavy("rain")).toBe(false);
    expect(isHeavy("drizzle")).toBe(false);
  });

  it("counts a trace of rain as wet, on the same threshold as the hour in progress", () => {
    // DRY_MM is 0.1: under a dry code, a tenth of a millimetre still counts as rain.
    expect(rainSoon([hour(1, 0.1, 2)], T0)?.wet).toBe(true);
    expect(rainSoon([hour(1, 0.05, 2)], T0)?.wet).toBe(false);
  });

  it("gives the highest chance of the hours it read, where the model gives one at all", () => {
    expect(rainSoon([hour(1, 1, 61, 40), hour(2, 1, 61, 85)], T0)?.chance).toBe(85);
    expect(rainSoon([hour(1, 1, 61)], T0)?.chance).toBeNull();
  });

  it("ignores an hour whose time cannot be read rather than counting it as now", () => {
    const broken = { ...hour(1, 9, 65), at: "not a time" };
    expect(rainSoon([broken, hour(2, 1, 61)], T0)?.mm).toBe(1);
  });
});
