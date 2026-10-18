/**
 * The theme: dark after sunset, light at sunrise (lib/sun.ts), and a switch in the header for
 * anyone who would rather have the other one (the owner's request, 18 Oct).
 *
 * How long a hand-picked theme lasts is the owner's choice: the rest of that day, and never
 * longer. Every visit on a new day starts from the sun again, so the app's own rule stays the
 * default and nobody is left stuck in a theme they picked once weeks ago.
 *
 * The day is the day of the phone holding it, not Bangkok's: it is the person's own evening
 * that the choice is about.
 */
export type ThemeMode = "light" | "dark";

/** What is kept on the phone: the picked theme and the day it was picked. */
export type ThemeChoice = { mode: ThemeMode; day: string };

/** The key in lib/phone-store (so, `jaga.theme` in localStorage). */
export const THEME_KEY = "theme";

/** The phone's own calendar day, as YYYY-MM-DD. */
export function dayStamp(now: number): string {
  const d = new Date(now);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The stored choice if it is still today's, else null: from tomorrow the sun decides again. */
export function choiceToday(stored: unknown, now: number): ThemeMode | null {
  const choice = stored as ThemeChoice | null;
  if (!choice || (choice.mode !== "dark" && choice.mode !== "light")) return null;
  return choice.day === dayStamp(now) ? choice.mode : null;
}

/** What to store when someone picks a theme. */
export function pickChoice(mode: ThemeMode, now: number): ThemeChoice {
  return { mode, day: dayStamp(now) };
}

export const OTHER: Record<ThemeMode, ThemeMode> = { light: "dark", dark: "light" };

/*
 * "This visit, and remembered for the day" (the owner, 18 Oct): the day stamp above ends the
 * choice for the *next* visit, and this holds it for as long as this one lasts. Without it,
 * someone who picked light at 23:50 would watch the app go dark by itself at midnight while
 * they were reading it.
 *
 * It lives for as long as the tab does and is not stored anywhere: closing the app is what ends
 * a visit, and then the day stamp alone decides.
 */
let held: ThemeMode | null = null;

export function holdForVisit(mode: ThemeMode): void {
  held = mode;
}

/** The theme to show: today's stored choice, else one picked earlier in this same visit. */
export function pickedTheme(stored: unknown, now: number): ThemeMode | null {
  const today = choiceToday(stored, now);
  if (today) held = today;
  return today ?? held;
}

/** Only for the tests: forget what this visit picked. */
export function forgetVisit(): void {
  held = null;
}
