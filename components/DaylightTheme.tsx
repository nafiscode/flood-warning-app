"use client";

import { useEffect } from "react";
import type { Area } from "@/lib/area";
import { useStored } from "@/lib/phone-store";
import { isNight, nextChange, SERVICE_CENTRE } from "@/lib/sun";
import { pickedTheme, THEME_KEY } from "@/lib/theme";

/**
 * Keeps the app's colours with the sun while it is open: dark after sunset, light at sunrise
 * (the owner's note, 9 Oct). Every visit starts this way - the time of day is the default.
 *
 * Someone who would rather have the other theme switches it in the header (ThemeSwitch, 18 Oct);
 * that choice holds for the rest of their day, and this stands aside while it does. The day
 * stamp never runs out under their feet: lib/theme holds a choice for as long as the visit
 * lasts, so midnight ends it only for the next one.
 *
 * The page already arrives the right colour (lib/theme-script.ts runs before the first paint);
 * this only follows the change while someone is looking, and after they pick a new area.
 */
export function DaylightTheme() {
  const area = useStored<Area>("area");
  const stored = useStored(THEME_KEY);
  const lat = area?.lat ?? SERVICE_CENTRE.lat;
  const lon = area?.lon ?? SERVICE_CENTRE.lon;

  useEffect(() => {
    let timer = 0;
    const apply = () => {
      const now = Date.now();
      const picked = pickedTheme(stored, now);
      document.documentElement.dataset.theme =
        picked ?? (isNight(now, lat, lon) ? "dark" : "light");
      // Wake up at the next sunrise or sunset, and at least once an hour in case the phone
      // slept through it or its clock was changed. A picked theme is checked on the same beat:
      // it is the clock passing midnight that ends it, and only for the next visit.
      window.clearTimeout(timer);
      const wait = picked
        ? 3600000
        : Math.min(Math.max(nextChange(now, lat, lon) - now, 1000), 3600000);
      timer = window.setTimeout(apply, wait);
    };
    apply();
    document.addEventListener("visibilitychange", apply);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", apply);
    };
  }, [lat, lon, stored]);

  return null;
}
