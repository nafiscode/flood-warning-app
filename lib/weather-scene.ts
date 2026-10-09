/**
 * The sky behind the "now" card (the owner's request, 10 Oct 2026): what the weather looks like
 * at this moment — a bright sky and a sun, cloud drifting past, rain falling or running down the
 * glass, stars and the moon in its right shape at night.
 *
 * It is drawn with plain elements and CSS alone (components/weather/WeatherScene.module.css):
 * no images, no canvas and no library, so it costs a few hundred bytes and a cheap phone can
 * carry it. Everything stops under "reduced motion".
 *
 * None of these colours is an alert hue (docs/brand.md). A sky is not a status, and in an app
 * where orange and red mean Warning and Evacuate, a sunset must never be painted in them:
 * the skies here stay in blues, slates and pale sand, and a test keeps it so.
 */
import type { WeatherGroup } from "@/lib/weather";

export const SCENES = [
  "clearDay",
  "clearNight",
  "partlyDay",
  "partlyNight",
  "overcast",
  "fog",
  "drizzle",
  "rain",
  "showers",
  "thunder",
  "snow",
] as const;
export type Scene = (typeof SCENES)[number];

export type SceneLook = {
  /** Sky, from the top of the card down. */
  sky: [string, string];
  /** Which way the writing on the sky goes, so it stays readable on it. */
  ink: "dark" | "light";
  /** What is drawn on the sky. */
  sun?: boolean;
  moon?: boolean;
  stars?: boolean;
  clouds?: 0 | 2 | 3;
  /** Falling rain: fine drops, or streaks when it is heavier. */
  drops?: "fine" | "streaks";
  /** Drops sitting on the glass, as in a passing shower. */
  glass?: boolean;
  mist?: boolean;
  flakes?: boolean;
  flash?: boolean;
};

export const SCENE_LOOKS: Record<Scene, SceneLook> = {
  clearDay: { sky: ["#8FC4E8", "#D9EBF6"], ink: "dark", sun: true },
  clearNight: { sky: ["#0B1A2B", "#1D3B53"], ink: "light", moon: true, stars: true },
  partlyDay: { sky: ["#8CBBDC", "#D3E4EE"], ink: "dark", sun: true, clouds: 2 },
  partlyNight: { sky: ["#0C1C2D", "#223D55"], ink: "light", moon: true, stars: true, clouds: 2 },
  overcast: { sky: ["#8E9CA6", "#C3CCD2"], ink: "dark", clouds: 3 },
  fog: { sky: ["#A7B2B8", "#D7DDDF"], ink: "dark", mist: true, clouds: 2 },
  drizzle: { sky: ["#7F929E", "#B6C3CA"], ink: "dark", clouds: 3, drops: "fine" },
  rain: { sky: ["#54707F", "#8FA3AE"], ink: "light", clouds: 3, drops: "streaks" },
  showers: { sky: ["#637C8B", "#9DB0B9"], ink: "light", clouds: 3, drops: "fine", glass: true },
  thunder: { sky: ["#2F4350", "#5C7382"], ink: "light", clouds: 3, drops: "streaks", flash: true },
  snow: { sky: ["#8DA2B5", "#DCE5EC"], ink: "dark", clouds: 2, flakes: true },
};

/** The sky for a condition at this hour of the day. */
export function sceneFor(group: WeatherGroup, isDay: boolean): Scene {
  switch (group) {
    case "clear":
      return isDay ? "clearDay" : "clearNight";
    case "mainlyClear":
    case "partlyCloudy":
      return isDay ? "partlyDay" : "partlyNight";
    case "overcast":
      return "overcast";
    case "fog":
      return "fog";
    case "drizzle":
    case "rainLight":
      return "drizzle";
    case "rain":
    case "rainHeavy":
      return "rain";
    case "showers":
    case "showersHeavy":
      return "showers";
    case "thunder":
    case "thunderHail":
      return "thunder";
    case "snow":
      return "snow";
  }
}

/** The colour the temperature and the condition are written in on a given sky. */
export const SCENE_INK = { dark: "#13293A", light: "#FFFFFF" } as const;

/**
 * A veil over the sky, under the writing. The sky stays a sky, and the temperature keeps its
 * contrast on every one of them: tests/unit/weather-scene.test.ts composites this over both
 * ends of each sky and holds the result to at least 4.5:1 (CLAUDE.md, accessibility).
 */
export const SCRIM_ALPHA = 0.45;
export const SCRIM_COLOR = { dark: "#F7FAFC", light: "#09141E" } as const;

/** The veil as CSS, for the scene whose ink is `ink`. */
export function scrim(ink: SceneLook["ink"]): string {
  const hex = SCRIM_COLOR[ink];
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${SCRIM_ALPHA})`;
}

/**
 * Day or night where the person is looking, at the moment they are looking.
 *
 * Not the `is_day` flag of the reading: that is the model's answer for the hour the forecast
 * was made for, and a phone with no signal can be holding a reading from hours ago — which
 * would paint a sunny sky at midnight. The sun's own times for that place decide it instead
 * (lib/sun.ts, the same equation that turns the app dark at night), and the flag is kept only
 * for the far north and south, where the sun may not rise or set that day at all.
 */
export function isDaylight(
  at: number,
  lat: number,
  lon: number,
  fallback: boolean,
  times: (now: number, lat: number, lon: number) => { sunrise: number; sunset: number } | null,
): boolean {
  const sun = times(at, lat, lon);
  if (!sun) return fallback;
  return at >= sun.sunrise && at < sun.sunset;
}
