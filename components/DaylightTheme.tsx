"use client";

import { useEffect } from "react";
import type { Area } from "@/lib/area";
import { useStored } from "@/lib/phone-store";
import { isNight, nextChange, SERVICE_CENTRE } from "@/lib/sun";

/**
 * Keeps the app's colours with the sun while it is open: dark after sunset, light at sunrise
 * (the owner's note, 9 Oct). There is nothing to switch, by design - the time of day decides.
 *
 * The page already arrives the right colour (lib/theme-script.ts runs before the first paint);
 * this only follows the change while someone is looking, and after they pick a new area.
 */
export function DaylightTheme() {
  const area = useStored<Area>("area");
  const lat = area?.lat ?? SERVICE_CENTRE.lat;
  const lon = area?.lon ?? SERVICE_CENTRE.lon;

  useEffect(() => {
    let timer = 0;
    const apply = () => {
      const now = Date.now();
      document.documentElement.dataset.theme = isNight(now, lat, lon) ? "dark" : "light";
      // Wake up at the next sunrise or sunset, and at least once an hour in case the phone
      // slept through it or its clock was changed.
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
  }, [lat, lon]);

  return null;
}
