"use client";

import { useEffect } from "react";
import type { Area } from "@/lib/area";
import { useStored } from "@/lib/phone-store";
import { isNight, nextChange, SERVICE_CENTRE } from "@/lib/sun";
import { themeFor, THEME_KEY } from "@/lib/theme";

/**
 * Keeps the app's colours with the sun while it is open: dark after sunset, light at sunrise
 * (the owner's note, 9 Oct). Every visit starts this way - the time of day is the default.
 *
 * Someone who would rather have the other theme switches it in the header (ThemeSwitch, 18 Oct),
 * and that choice stands until the sun next changes. So this keeps waking at every sunrise and
 * sunset whether or not a theme was picked: at that moment the choice has run out and the sun
 * takes the app back, even in a tab that has been open all day (the owner's ask, 18 Oct).
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
      /*
       * The time of day, and then the theme. The maps read the first (lib/map.ts, nightNow) and
       * the page's colours the second: a theme picked by hand turns the app dark at noon without
       * turning the district's daylight picture into a night map (the owner, 20 Oct 2026).
       */
      document.documentElement.dataset.daylight = isNight(now, lat, lon) ? "night" : "day";
      document.documentElement.dataset.theme = themeFor(stored, now, lat, lon);
      // Wake up at the next sunrise or sunset, and at least once an hour in case the phone
      // slept through it or its clock was changed. That moment is both when the sun changes the
      // theme and when a picked one expires, so one timer does for either.
      window.clearTimeout(timer);
      const wait = Math.min(Math.max(nextChange(now, lat, lon) - now, 1000), 3600000);
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
