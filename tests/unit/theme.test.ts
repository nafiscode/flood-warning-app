/**
 * The app turns dark after sunset and light at sunrise (the owner's note, 9 Oct), and since
 * 18 Oct a switch in the header can overrule that until the sun next changes. What is worth
 * testing: the sun times are right, the copy of the calculation that runs before the first paint
 * agrees with the module, a picked theme lasts exactly as long as it should - no longer, so the
 * app still turns dark at sunset by itself - and the dark colours are readable.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contrastRatio } from "@/lib/brand/contrast";
import { darkBrand, darkContrastPairs } from "@/lib/brand/tokens";
import { isNight, nextChange, SERVICE_CENTRE, sunTimes } from "@/lib/sun";
import { DAYLIGHT_SCRIPT } from "@/lib/theme-script";
import { OTHER, pickChoice, pickedTheme, themeFor } from "@/lib/theme";

const PATTANI = { lat: 6.87, lon: 101.25 };
const bangkok = (ms: number) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ms));

/** Run the inline script with a stubbed page and clock, and report what it set. */
function runScript(
  now: number,
  area: { lat: number; lon: number } | null,
  picked?: unknown,
): string {
  const root = { dataset: {} as Record<string, string> };
  const stored: Record<string, unknown> = { "jaga.area": area, "jaga.theme": picked ?? null };
  const fake = {
    document: { documentElement: root },
    localStorage: {
      getItem: (key: string) =>
        stored[key] == null ? null : JSON.stringify(stored[key]),
    },
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

/** The same run, but what it wrote about the time of day rather than the theme. */
function runScriptDaylight(
  now: number,
  area: { lat: number; lon: number } | null,
  picked?: unknown,
): string {
  const root = { dataset: {} as Record<string, string> };
  const stored: Record<string, unknown> = { "jaga.area": area, "jaga.theme": picked ?? null };
  new Function("document", "localStorage", "Date", DAYLIGHT_SCRIPT)(
    { documentElement: root },
    {
      getItem: (key: string) => (stored[key] == null ? null : JSON.stringify(stored[key])),
    },
    class extends Date {
      static now() {
        return now;
      }
    },
  );
  return root.dataset.daylight!;
}

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

describe("a theme picked by hand", () => {
  // Pattani on 9 Oct 2026: sunrise 06:03, sunset 18:04 (checked against published times above).
  const at = (hhmm: string, day = "2026-10-09") => Date.parse(`${day}T${hhmm}:00+07:00`);
  const picked = (stored: unknown, now: number) =>
    pickedTheme(stored, now, PATTANI.lat, PATTANI.lon);
  const shown = (stored: unknown, now: number) => themeFor(stored, now, PATTANI.lat, PATTANI.lon);

  it("is the other one, both ways", () => {
    expect(OTHER.light).toBe("dark");
    expect(OTHER.dark).toBe("light");
  });

  it("holds while the sun stays where it was", () => {
    const choice = pickChoice("dark", at("10:00"));
    expect(picked(choice, at("10:00"))).toBe("dark");
    expect(picked(choice, at("13:00"))).toBe("dark");
    // One minute before sunset it is still theirs, against a sun that says light.
    expect(shown(choice, at("18:03"))).toBe("dark");
  });

  it("the sun takes the app back at sunset, whatever was picked", () => {
    // The owner's rule, 18 Oct: when night starts the app goes dark by itself.
    const choice = pickChoice("light", at("10:00"));
    expect(shown(choice, at("17:00"))).toBe("light");
    expect(picked(choice, at("18:05"))).toBeNull();
    expect(shown(choice, at("18:05"))).toBe("dark");
    expect(shown(choice, at("23:00"))).toBe("dark");
  });

  it("and at sunrise, so a dark night does not follow anyone into the morning", () => {
    const choice = pickChoice("dark", at("21:00"));
    // Through the night, midnight included: the next change is the coming sunrise, not 00:00.
    expect(shown(choice, at("23:59"))).toBe("dark");
    expect(shown(choice, at("02:00", "2026-10-10"))).toBe("dark");
    expect(picked(choice, at("06:04", "2026-10-10"))).toBeNull();
    expect(shown(choice, at("06:04", "2026-10-10"))).toBe("light");
  });

  it("a choice made at night survives midnight", () => {
    // What the owner asked for on the first build and still holds: picking light at 23:50 must
    // not turn the app dark by itself half an hour later while they are reading it.
    const choice = pickChoice("light", at("23:50"));
    expect(shown(choice, at("00:20", "2026-10-10"))).toBe("light");
    expect(shown(choice, at("05:00", "2026-10-10"))).toBe("light");
  });

  it("nothing else in storage can set a theme", () => {
    const junk = [
      null,
      {},
      { mode: "dark" },
      { mode: "sepia", at: at("10:00") },
      { mode: "dark", at: "soon" },
      { mode: "dark", at: Number.NaN },
      // The shape the first build of the switch stored, earlier the same day.
      { mode: "dark", day: "2026-10-09" },
      7,
      "dark",
    ];
    for (const one of junk) expect(picked(one, at("10:00"))).toBeNull();
  });

  it("a choice from the future is thrown away", () => {
    // A phone whose clock was moved back would otherwise hold it for as long as it was wrong.
    expect(picked(pickChoice("dark", at("13:00")), at("10:00"))).toBeNull();
  });

  it("the page arrives already in the picked colour, before the first paint", () => {
    const noon = at("12:00");
    expect(runScript(noon, PATTANI)).toBe("light");
    expect(runScript(noon, PATTANI, pickChoice("dark", noon))).toBe("dark");
    expect(runScript(at("21:00"), PATTANI, pickChoice("light", at("21:00")))).toBe("light");
    // And in the sun's colour once the choice has run out.
    expect(runScript(at("18:05"), PATTANI, pickChoice("light", noon))).toBe("dark");
  });

  it("the script and lib/theme agree about every hour of a year, picked or not", () => {
    const start = Date.parse("2026-01-01T00:00:00Z");
    let checked = 0;
    for (let hour = 0; hour < 365 * 24; hour += 11) {
      const now = start + hour * 3600000;
      for (const place of [PATTANI, SERVICE_CENTRE]) {
        const area = place === SERVICE_CENTRE ? null : place;
        // Picked at this moment, three hours ago, and yesterday: holding, holding or expired.
        for (const made of [now, now - 3 * 3600000, now - 86400000]) {
          for (const mode of ["dark", "light"] as const) {
            const choice = pickChoice(mode, made);
            const want = themeFor(choice, now, place.lat, place.lon);
            expect(`${new Date(now).toISOString()} ${runScript(now, area, choice)}`).toBe(
              `${new Date(now).toISOString()} ${want}`,
            );
            checked += 1;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(2000);
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

  it("the label on a map pin is dark too, and only after sunset", () => {
    // MapLibre paints its popup white from its own stylesheet, which left the label's light
    // text on a white box at night (the owner saw it, 9 Oct).
    const css = readFileSync("app/globals.css", "utf8");
    const blocks = css
      .split("*/")
      .map((part) => (part.includes("/*") ? part.slice(0, part.indexOf("/*")) : part))
      .join(" ")
      .split("}")
      .map((block) => ({
        selector: block.slice(0, block.indexOf("{")).trim(),
        body: block.slice(block.indexOf("{") + 1),
      }))
      .filter((b) => b.selector.includes("maplibregl-popup"));
    // Only a rule that colours the pop-up must wait for the night; the one that gives it the
    // app's face and sizes (14 Oct) holds in both themes.
    const selectors = blocks
      .filter((b) => /(^|[\s;])(background|color|border(-[a-z]+)*-color)\s*:/.test(b.body))
      .map((b) => b.selector);
    expect(selectors.length).toBeGreaterThan(0);
    for (const selector of selectors) {
      for (const one of selector.split(",")) {
        expect(one.trim().startsWith(':root[data-theme="dark"]')).toBe(true);
      }
    }
    expect(css).toContain("background: var(--jaga-surface)");
  });

  it("the only control over it is the switch in the header", () => {
    // The sun decides what a visit starts as: nothing but ThemeSwitch may set a theme, so a
    // page or a card can never quietly paint itself the other way.
    for (const file of ["components/DaylightTheme.tsx", "app/[locale]/layout.tsx", "lib/theme-script.ts"]) {
      expect(readFileSync(file, "utf8")).not.toMatch(/onClick/);
    }
    const header = readFileSync("app/[locale]/layout.tsx", "utf8");
    expect(header).toContain("<ThemeSwitch />");
    const switcher = readFileSync("components/ThemeSwitch.tsx", "utf8");
    // Beside the bell, and a 48 px target like every other control (CLAUDE.md).
    expect(header.indexOf("<ThemeSwitch />")).toBeLessThan(header.indexOf("<NoticeBell />"));
    expect(switcher).toContain("min-h-tap");
    // Icon plus words: an icon alone does not say which theme is on.
    expect(switcher).toContain("aria-label");
    // No eye icons anywhere in the UI (CLAUDE.md); a sun and a moon say it.
    expect(switcher).not.toMatch(/Eye/);
  });

  it("the alert palette is the same by day and by night (docs/brand.md)", () => {
    const css = readFileSync("app/globals.css", "utf8").toLowerCase();
    const dark = css.slice(css.indexOf(':root[data-theme="dark"]'));
    const end = dark.indexOf("}");
    expect(dark.slice(0, end)).not.toContain("--alert-");
    expect(dark.slice(0, end)).not.toContain("--sos");
  });
});

/*
 * The background of the map follows the sun and not the theme (the owner, 20 Oct 2026). The page
 * carries both: `data-theme` is what colour the app is, `data-daylight` is what time of day it
 * is where the reader is, and lib/map.ts reads the second.
 */
describe("the time of day, written beside the theme", () => {
  const day = "2026-10-09";
  const at = (hhmm: string) => Date.parse(`${day}T${hhmm}:00+07:00`);

  it("says day or night from the sun, whatever theme was picked", () => {
    expect(runScriptDaylight(at("12:00"), PATTANI)).toBe("day");
    expect(runScriptDaylight(at("22:00"), PATTANI)).toBe("night");
    // A theme picked by hand changes the theme and nothing about the daylight.
    const noon = at("12:00");
    expect(runScript(noon, PATTANI, pickChoice("dark", noon))).toBe("dark");
    expect(runScriptDaylight(noon, PATTANI, pickChoice("dark", noon))).toBe("day");
    const night = at("22:00");
    expect(runScript(night, PATTANI, pickChoice("light", night))).toBe("light");
    expect(runScriptDaylight(night, PATTANI, pickChoice("light", night))).toBe("night");
  });

  it("is what the map goes by, with the theme only as a fallback", async () => {
    const { nightNow } = await import("@/lib/map");
    const root = document.documentElement;
    root.dataset.theme = "dark";
    delete root.dataset.daylight;
    // No daylight written yet (an older page): the theme is all there is to go on.
    expect(nightNow()).toBe(true);
    root.dataset.daylight = "day";
    expect(nightNow()).toBe(false);
    root.dataset.theme = "light";
    root.dataset.daylight = "night";
    expect(nightNow()).toBe(true);
    delete root.dataset.daylight;
    delete root.dataset.theme;
  });
});
