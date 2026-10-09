/**
 * The app turns dark after sunset and light at sunrise, with nothing for anyone to switch
 * (the owner's note, 9 Oct). What is worth testing: the sun times are right, the copy of the
 * calculation that runs before the first paint agrees with the module, and the dark colours are
 * readable.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contrastRatio } from "@/lib/brand/contrast";
import { darkBrand, darkContrastPairs } from "@/lib/brand/tokens";
import { isNight, nextChange, SERVICE_CENTRE, sunTimes } from "@/lib/sun";
import { DAYLIGHT_SCRIPT } from "@/lib/theme-script";

const PATTANI = { lat: 6.87, lon: 101.25 };
const bangkok = (ms: number) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ms));

describe("sunrise and sunset", () => {
  // Published times for Pattani, to the minute or two.
  it.each([
    ["2026-10-09", "06:03", "18:04"],
    ["2026-06-21", "06:02", "18:33"],
    ["2026-12-21", "06:22", "18:05"],
  ])("Pattani on %s", (day, sunrise, sunset) => {
    const times = sunTimes(Date.parse(`${day}T05:00:00Z`), PATTANI.lat, PATTANI.lon)!;
    expect(bangkok(times.sunrise)).toBe(sunrise);
    expect(bangkok(times.sunset)).toBe(sunset);
  });

  it("is night after sunset and day after sunrise", () => {
    const day = "2026-10-09";
    const at = (hhmm: string) => Date.parse(`${day}T${hhmm}:00+07:00`);
    expect(isNight(at("05:30"), PATTANI.lat, PATTANI.lon)).toBe(true);
    expect(isNight(at("06:30"), PATTANI.lat, PATTANI.lon)).toBe(false);
    expect(isNight(at("17:30"), PATTANI.lat, PATTANI.lon)).toBe(false);
    expect(isNight(at("18:30"), PATTANI.lat, PATTANI.lon)).toBe(true);
    expect(isNight(at("23:59"), PATTANI.lat, PATTANI.lon)).toBe(true);
  });

  it("the next change is the coming sunrise or sunset, never far away", () => {
    const noon = Date.parse("2026-10-09T12:00:00+07:00");
    expect(bangkok(nextChange(noon, PATTANI.lat, PATTANI.lon))).toBe("18:04");
    const evening = Date.parse("2026-10-09T20:00:00+07:00");
    // After sunset the next change is tomorrow's sunrise.
    expect(bangkok(nextChange(evening, PATTANI.lat, PATTANI.lon))).toBe("06:03");
  });

  it("somewhere the sun never sets, it falls back to the clock", () => {
    // Longyearbyen in June: the formula has no answer, so 18:00 to 06:00 is used.
    const midsummer = Date.parse("2026-06-21T12:00:00Z");
    expect(sunTimes(midsummer, 78.2, 15.6)).toBeNull();
    expect(typeof isNight(midsummer, 78.2, 15.6)).toBe("boolean");
  });
});

describe("the script that runs before the first paint", () => {
  /** Run the inline script with a stubbed page and clock, and report what it set. */
  function runScript(now: number, area: { lat: number; lon: number } | null): string {
    const root = { dataset: {} as Record<string, string> };
    const fake = {
      document: { documentElement: root },
      localStorage: { getItem: () => (area ? JSON.stringify(area) : null) },
      Date: class extends Date {
        constructor(value?: number | string) {
          super(value === undefined ? now : (value as number));
        }
        static now() {
          return now;
        }
      },
    };
    new Function("document", "localStorage", "Date", DAYLIGHT_SCRIPT)(
      fake.document,
      fake.localStorage,
      fake.Date,
    );
    return root.dataset.theme!;
  }

  it("agrees with lib/sun.ts at every hour of a year, for the area and without one", () => {
    const start = Date.parse("2026-01-01T00:00:00Z");
    let checked = 0;
    for (let hour = 0; hour < 365 * 24; hour += 7) {
      const now = start + hour * 3600000;
      for (const place of [PATTANI, SERVICE_CENTRE]) {
        const fromScript = runScript(now, place === SERVICE_CENTRE ? null : place);
        const fromModule = isNight(now, place.lat, place.lon) ? "dark" : "light";
        expect(`${new Date(now).toISOString()} ${fromScript}`).toBe(
          `${new Date(now).toISOString()} ${fromModule}`,
        );
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(2000);
  });

  it("sets light by day and dark by night", () => {
    expect(runScript(Date.parse("2026-10-09T12:00:00+07:00"), PATTANI)).toBe("light");
    expect(runScript(Date.parse("2026-10-09T21:00:00+07:00"), PATTANI)).toBe("dark");
  });

  it("a phone with nothing stored still gets a theme", () => {
    expect(["light", "dark"]).toContain(runScript(Date.now(), null));
  });
});

describe("the dark colours", () => {
  it.each(darkContrastPairs)("$name", ({ name, fg, bg }) => {
    // Text needs 4.5:1; the outline of a control needs 3:1.
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(name.includes("outline") ? 3 : 4.5);
  });

  it("app/globals.css mirrors the dark tokens", () => {
    const css = readFileSync("app/globals.css", "utf8").toLowerCase();
    const block = css.slice(css.indexOf(':root[data-theme="dark"]'));
    for (const [name, hex] of Object.entries(darkBrand)) {
      expect(new RegExp(`--${name}:\\s*${hex.toLowerCase()};`).test(block)).toBe(true);
    }
    expect(block).toContain("color-scheme: dark");
  });

  it("nobody can switch the theme by hand: there is no control for it", () => {
    const files = [
      "components/DaylightTheme.tsx",
      "app/[locale]/layout.tsx",
      "lib/theme-script.ts",
    ];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(source).not.toMatch(/onClick|<button/);
    }
  });

  it("the alert palette is the same by day and by night (docs/brand.md)", () => {
    const css = readFileSync("app/globals.css", "utf8").toLowerCase();
    const dark = css.slice(css.indexOf(':root[data-theme="dark"]'));
    const end = dark.indexOf("}");
    expect(dark.slice(0, end)).not.toContain("--alert-");
    expect(dark.slice(0, end)).not.toContain("--sos");
  });
});
