/**
 * The theme: dark after sunset, light at sunrise (lib/sun.ts), and a switch in the header for
 * anyone who would rather have the other one (the owner's request, 18 Oct).
 *
 * How long a hand-picked theme lasts is the owner's choice, settled on 18 Oct: **until the sun
 * next changes**. Pick light in the afternoon and the app still turns dark at sunset by itself;
 * pick dark at night and it is light again at sunrise. The sun is the rule, and a choice is a
 * one-off exception to it rather than a setting that outlives the daylight it was made in.
 *
 * It also means a choice can never outstay its welcome in an app left open: the same check runs
 * at every sunrise and sunset while Jaga is on screen (DaylightTheme), not only on the way in.
 */
import { isNight, nextChange } from "@/lib/sun";

export type ThemeMode = "light" | "dark";

/** What is kept on the phone: the picked theme and the moment it was picked. */
export type ThemeChoice = { mode: ThemeMode; at: number };

/** The key in lib/phone-store (so, `jaga.theme` in localStorage). */
export const THEME_KEY = "theme";

/** What to store when someone picks a theme. */
export function pickChoice(mode: ThemeMode, now: number): ThemeChoice {
  return { mode, at: now };
}

/**
 * The picked theme if the sun has not changed since it was picked, else null.
 *
 * A choice from the future is thrown away: a phone whose clock was moved back would otherwise
 * hold it for however long the clock was wrong. Anything else unexpected in storage - including
 * the `{mode, day}` of the first build, earlier on 18 Oct - counts as nothing, so the sun
 * decides and the next tap on the switch stores the new shape.
 */
export function pickedTheme(
  stored: unknown,
  now: number,
  lat: number,
  lon: number,
): ThemeMode | null {
  const choice = stored as ThemeChoice | null;
  if (!choice || (choice.mode !== "dark" && choice.mode !== "light")) return null;
  if (typeof choice.at !== "number" || !Number.isFinite(choice.at) || choice.at > now) return null;
  return nextChange(choice.at, lat, lon) > now ? choice.mode : null;
}

/** The theme to show: what they picked while it stands, else what the sun says. */
export function themeFor(stored: unknown, now: number, lat: number, lon: number): ThemeMode {
  return pickedTheme(stored, now, lat, lon) ?? (isNight(now, lat, lon) ? "dark" : "light");
}

export const OTHER: Record<ThemeMode, ThemeMode> = { light: "dark", dark: "light" };
