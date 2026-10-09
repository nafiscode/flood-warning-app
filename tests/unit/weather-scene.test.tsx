import { describe, expect, it } from "vitest";
import { WeatherScene } from "@/components/weather/WeatherScene";
import { contrastRatio } from "@/lib/brand/contrast";
import { alert as alertPalette, brand } from "@/lib/brand/tokens";
import { moonAt, moonPath, MOON_PHASES, NEW_MOON, phaseOf, SYNODIC_DAYS } from "@/lib/moon";
import th from "@/messages/th.json";
import { WEATHER_GROUPS } from "@/lib/weather";
import { sunTimes } from "@/lib/sun";
import {
  isDaylight,
  SCENE_INK,
  SCENE_LOOKS,
  SCENES,
  SCRIM_ALPHA,
  SCRIM_COLOR,
  sceneFor,
  scrim,
} from "@/lib/weather-scene";
import { renderWithIntl } from "./render";

/** The colour a half-transparent veil leaves behind, which is what the writing sits on. */
function veiled(top: string, alpha: number, bottom: string): string {
  const parts = (hex: string) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  const [tr, tg, tb] = parts(top);
  const [br, bg, bb] = parts(bottom);
  const mix = (a: number, b: number) => Math.round(a * alpha + b * (1 - alpha));
  return `#${[mix(tr!, br!), mix(tg!, bg!), mix(tb!, bb!)]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("")}`;
}

describe("the sky behind the temperature", () => {
  it("has a sky for every weather condition, by day and by night", () => {
    for (const group of WEATHER_GROUPS) {
      for (const isDay of [true, false]) {
        const scene = sceneFor(group, isDay);
        expect(SCENES).toContain(scene);
        expect(SCENE_LOOKS[scene]).toBeTruthy();
      }
    }
    expect(sceneFor("clear", true)).toBe("clearDay");
    expect(sceneFor("clear", false)).toBe("clearNight");
    expect(sceneFor("rainHeavy", true)).toBe("rain");
    expect(sceneFor("showers", false)).toBe("showers");
  });

  it("keeps the writing readable on every sky (4.5:1 after the veil)", () => {
    for (const scene of SCENES) {
      const look = SCENE_LOOKS[scene];
      for (const stop of look.sky) {
        const behind = veiled(SCRIM_COLOR[look.ink], SCRIM_ALPHA, stop);
        expect(contrastRatio(SCENE_INK[look.ink], behind)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("paints no sky in an alert colour (docs/brand.md)", () => {
    const forbidden = [
      ...Object.values(alertPalette).map((c) => c.bg.toLowerCase()),
      brand["jaga-teal"].toLowerCase(),
    ];
    for (const scene of SCENES) {
      for (const stop of SCENE_LOOKS[scene].sky) {
        expect(forbidden).not.toContain(stop.toLowerCase());
        // No warm sky either: a sunset in orange would sit next to Warning and Evacuate.
        const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(stop.slice(i, i + 2), 16));
        expect(b!).toBeGreaterThanOrEqual(r! - 4);
        expect(g!).toBeLessThan(Math.max(r!, b!) + 24);
      }
    }
  });

  it("writes the veil as a colour a browser understands", () => {
    expect(scrim("light")).toBe("rgba(9, 20, 30, 0.45)");
    expect(scrim("dark")).toBe("rgba(247, 250, 252, 0.45)");
  });
});

describe("day or night in the card", () => {
  // Bana, in Pattani: the sun is up from about 06:00 to about 18:00 all year.
  const lat = 6.878;
  const lon = 101.272;
  const bangkok = (h: number, day = 10) => Date.UTC(2026, 9, day, h - 7, 0);

  it("follows the sun at that place, not the flag in a reading that may be hours old", () => {
    // A reading taken in the afternoon, still on the phone at midnight with no signal.
    expect(isDaylight(bangkok(0), lat, lon, true, sunTimes)).toBe(false);
    expect(isDaylight(bangkok(23), lat, lon, true, sunTimes)).toBe(false);
    // And the other way: a reading from the night, looked at the next afternoon.
    expect(isDaylight(bangkok(14), lat, lon, false, sunTimes)).toBe(true);
  });

  it("is day between sunrise and sunset and night outside them", () => {
    expect(isDaylight(bangkok(5), lat, lon, true, sunTimes)).toBe(false);
    expect(isDaylight(bangkok(7), lat, lon, false, sunTimes)).toBe(true);
    expect(isDaylight(bangkok(17), lat, lon, false, sunTimes)).toBe(true);
    expect(isDaylight(bangkok(19), lat, lon, true, sunTimes)).toBe(false);
  });

  it("keeps the reading's own answer where the sun neither rises nor sets", () => {
    // Longyearbyen in January: no sunrise at all, so there is nothing to work out.
    const polarNight = Date.UTC(2026, 0, 10, 12, 0);
    expect(isDaylight(polarNight, 78.2, 15.6, false, sunTimes)).toBe(false);
    expect(isDaylight(polarNight, 78.2, 15.6, true, sunTimes)).toBe(true);
  });

  it("picks a night sky at night even for a sunny reading", () => {
    expect(sceneFor("clear", isDaylight(bangkok(2), lat, lon, true, sunTimes))).toBe("clearNight");
    expect(sceneFor("clear", isDaylight(bangkok(12), lat, lon, true, sunTimes))).toBe("clearDay");
  });
});

describe("the moon", () => {
  it("goes new, half, full, half over a month", () => {
    // Counted from a new moon that happened: 6 January 2000, 18:14 UTC.
    const months = Math.round((Date.UTC(2026, 9, 1) - NEW_MOON) / (SYNODIC_DAYS * 86_400_000));
    const newMoon = NEW_MOON + months * SYNODIC_DAYS * 86_400_000;
    const at = (days: number) => moonAt(newMoon + days * 86_400_000);
    expect(at(0).lit).toBeLessThan(0.05);
    expect(at(SYNODIC_DAYS / 4).lit).toBeCloseTo(0.5, 1);
    expect(at(SYNODIC_DAYS / 2).lit).toBeGreaterThan(0.95);
    expect(at((SYNODIC_DAYS * 3) / 4).lit).toBeCloseTo(0.5, 1);
    expect(at(1).waxing).toBe(true);
    expect(at(SYNODIC_DAYS / 2 + 2).waxing).toBe(false);
  });

  it("names all eight phases, and each has words in Thai", () => {
    const names = new Set(Array.from({ length: 60 }, (_, i) => phaseOf((i * SYNODIC_DAYS) / 60)));
    expect([...names].sort()).toEqual([...MOON_PHASES].sort());
    for (const phase of MOON_PHASES) {
      expect(th.weather.moons[phase as keyof typeof th.weather.moons]).toBeTruthy();
    }
    expect(phaseOf(0)).toBe("new");
    expect(phaseOf(SYNODIC_DAYS / 2)).toBe("full");
  });

  it("draws nothing at new moon, a full disc at full, and a shape in between", () => {
    expect(moonPath(0, true)).toBeNull();
    expect(moonPath(1, true)).toContain("A 10 10");
    const crescent = moonPath(0.2, true)!;
    const gibbous = moonPath(0.8, true)!;
    // Both are closed shapes made of the disc's edge and the line between light and dark.
    for (const path of [crescent, gibbous]) {
      expect(path.startsWith("M 0 -10")).toBe(true);
      expect(path.endsWith("Z")).toBe(true);
    }
    // Waxing and waning are mirror images: the arcs sweep the other way.
    expect(moonPath(0.3, true)).not.toBe(moonPath(0.3, false));
  });
});

describe("the scene as it is drawn", () => {
  const scene = (name: (typeof SCENES)[number]) =>
    renderWithIntl(<WeatherScene scene={name} now={Date.UTC(2026, 9, 17, 15, 0)} />).container;

  it("is decoration: hidden from screen readers, and says nothing of its own", () => {
    const box = scene("rain").firstElementChild!;
    expect(box.getAttribute("aria-hidden")).toBe("true");
    expect(box.textContent).toBe("");
  });

  it("puts the sky's two colours where the stylesheet expects them", () => {
    const box = scene("clearDay").firstElementChild as HTMLElement;
    expect(box.style.getPropertyValue("--sky-top")).toBe(SCENE_LOOKS.clearDay.sky[0]);
    expect(box.style.getPropertyValue("--sky-bottom")).toBe(SCENE_LOOKS.clearDay.sky[1]);
  });

  it("shows a sun by day, and the moon with stars at night", () => {
    expect(scene("clearDay").querySelectorAll("svg")).toHaveLength(0);
    const night = scene("clearNight");
    expect(night.querySelectorAll("svg")).toHaveLength(1);
    // The moon is drawn as a shape, not a letter or an image.
    expect(night.querySelector("svg path")?.getAttribute("d")).toMatch(/^M 0 -10/);
    expect(night.querySelectorAll("span").length).toBeGreaterThan(8); // the stars
  });

  it("rains only where it rains", () => {
    const dry = scene("clearDay").querySelectorAll("span").length;
    expect(dry).toBe(1); // the sun alone
    expect(scene("rain").querySelectorAll("span").length).toBeGreaterThan(10);
  });
});
