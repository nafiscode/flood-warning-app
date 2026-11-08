"use client";

import { useFormatter, useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import type { MyPlaces } from "@/lib/me";
import { useStored } from "@/lib/phone-store";
import { sunTimes } from "@/lib/sun";
import { useNow } from "@/lib/use-public";
import { useWeather, useWeatherPlace } from "@/lib/use-weather";
import { isStale, weatherGroup } from "@/lib/weather";
import { consoleVeil } from "@/lib/map-console";
import {
  isDaylight,
  SCENE_LOOKS,
  SCRIM_ALPHA,
  SCRIM_COLOR,
  sceneFor,
  type Scene,
} from "@/lib/weather-scene";
import { WeatherIcon } from "@/components/weather/WeatherIcon";
import { WeatherScene } from "@/components/weather/WeatherScene";

/**
 * The weather behind the laptop console (the owner, 16 Oct 2026: the grid lines go, and the whole
 * area carries the moving sky from the weather widget, with the weather itself written small in
 * the empty space on the right).
 *
 * The sky is the same one the weather page and the header's pill draw, so there is one picture of
 * the weather in the app and not three. It is decoration and says so: hidden from screen readers,
 * no layout animated, and it stops for anyone who has asked for less motion (WeatherScene).
 *
 * A veil over it keeps every word on the console at its usual contrast - the console's own text
 * is the theme's ink, not the scene's, so the veil is strong enough that the ink never has to
 * change. The sky reads as weather, never as a status: a flood level is only ever the alert
 * palette with its icon and word (safety rules 3 and 8), and nothing here says anything about
 * flooding.
 */

/** What the console knows about the weather. Null until a reading has been kept on this device. */
function useConsoleWeather() {
  const locale = useLocale();
  const me = useStored<MyPlaces>("me");
  const { place } = useWeatherPlace(me, locale);
  /*
   * `false`: this asks for nothing. The header's pill is on every page, including this one, and
   * it already keeps the reading fresh; both read the same one from the device's own store, so
   * the console costs no extra request (CLAUDE.md, budget).
   */
  const { weather } = useWeather(place, false);
  const now = useNow();
  if (!place || !weather) return null;
  const group = weatherGroup(weather.code);
  const isDay = isDaylight(
    now || Date.parse(weather.at),
    weather.lat,
    weather.lon,
    weather.isDay,
    sunTimes,
  );
  return {
    place,
    weather,
    group,
    isDay,
    now,
    scene: sceneFor(group, isDay) as Scene,
    degrees: weather.tempC === null ? null : Math.round(weather.tempC),
    // Before the device's clock can be read (the server's HTML) nothing is called old.
    stale: now > 0 && isStale(weather.at, now),
  };
}

/** A hex colour (#rrggbb) as the "r g b" triplet an `rgb(... / a)` custom property wants. */
function rgbTriplet(hex: string): string {
  return [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)).join(" ");
}

/**
 * The moving sky itself, behind everything on the console (or, with `bar`, behind the header of
 * the team's war room - the owner, 24 Oct 2026: "on the laptop view, add on the header the weather
 * animation like the main map page"). It goes in as the first child of the
 * console, and the rest of the console is lifted above it in app/globals.css.
 *
 * Two veils, one picture. The war room's header carries the theme's ink, so its sky keeps the
 * theme veil - the lightest one that still holds that ink at 4.5:1 (lib/map-console.ts). The map
 * console now wears the home screen's weather-card treatment instead (the owner, 9 Nov 2026: on a
 * laptop in the light theme the strip's sky "is not clear ... while the weather card ... appear
 * good"). The reason it was muddy: to carry dark ink the light theme bleached every sky toward
 * white. The card never does that - it veils the sky by the *scene*, not the theme, and writes on
 * it in the sky's own ink (white on a rainy sky, dark slate on a bright one). So the map sky now
 * hands the scene's scrim and ink down to app/globals.css, and a rainy sky stays deep and a clear
 * one stays blue, exactly as the card. None of this is a status: a sky is a sky (safety rule 8).
 */
export function ConsoleSky({ bar = false }: { bar?: boolean } = {}) {
  const sky = useConsoleWeather();
  if (!sky) return null;
  const look = SCENE_LOOKS[sky.scene];
  const veil = consoleVeil(look.sky);
  // The war room keeps the theme veil; the map console takes the card's scene scrim and ink.
  const skin: Record<string, string | number> = bar
    ? { "--veil-day": veil.light, "--veil-night": veil.dark }
    : {
        "--sky-scrim": rgbTriplet(SCRIM_COLOR[look.ink]),
        "--sky-scrim-alpha": SCRIM_ALPHA,
      };
  return (
    /*
     * Nothing of this exists below the console's own breakpoint: `hidden` is display:none, so on
     * a phone the sky is not drawn, not animated and not in the way of anything.
     */
    <div
      data-console-sky={sky.scene}
      // Which way the writing on the map sky goes, read by app/globals.css to pick white or dark
      // ink for the title, the note and the weather - the same choice the card makes per scene.
      data-console-sky-ink={bar ? undefined : look.ink}
      aria-hidden="true"
      className={bar ? undefined : "hidden console:block"}
      // On the team's war room the sky is a bar behind its header, placed by its own wrapper
      // (app/globals.css, [data-sky-bar]) and not by the map console's grid.
      data-sky-bar={bar ? "true" : undefined}
      style={
        {
          ...skin,
          /*
           * The sun and the moon are moved out of the top right, where the temperature is
           * written (the owner, 16 Oct: the moon sat behind the number). They go to the foot of
           * the bar instead: the left of it is taken by the page's title and by the hazard
           * buttons, which are solid and would simply hide them, while the lower right is clear
           * in every language at every laptop width - 155 px at its narrowest, which is room
           * enough for a 44 px moon.
           */
          "--sky-light-top": "auto",
          "--sky-light-bottom": "8%",
          "--sky-light-end": "2%",
        } as React.CSSProperties
      }
    >
      {/* The clouds keep to the open end of the bar, not behind the title (the owner, 20 Oct). */}
      <WeatherScene scene={sky.scene} now={sky.now} cloudLane="end" />
      <div data-console-veil="true" />
    </div>
  );
}

/**
 * The weather in words, small, in the empty half of the console's first line. The sky alone is a
 * picture; this is what it means, which is what a reader can act on.
 */
export function ConsoleWeather() {
  const t = useTranslations("weather");
  const format = useFormatter();
  const sky = useConsoleWeather();
  if (!sky) return null;
  const { weather, group, isDay, degrees, stale, place } = sky;
  const condition = t(`codes.${group}`);
  const time = format.dateTime(new Date(weather.at), {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: weather.timezone,
  });
  return (
    <Link
      href="/weather"
      prefetch={false}
      data-console-weather={sky.scene}
      // `me-10` keeps it off the screen's edge: pushed all the way it read as falling off (owner).
      className="hidden min-h-tap items-center gap-2 rounded-full text-jaga-ink no-underline console:ms-auto console:me-10 console:inline-flex"
      // One sentence for a screen reader, the same one the header's pill gives.
      aria-label={
        degrees === null
          ? t("chip.readingNoTemp", { condition, place: place.name })
          : stale
            ? t("chip.readingAt", { condition, degrees, place: place.name, time })
            : t("chip.reading", { condition, degrees, place: place.name })
      }
    >
      <WeatherIcon group={group} isDay={isDay} size={26} className="shrink-0" />
      <span aria-hidden="true" className="text-h3 font-bold tabular-nums">
        {degrees === null ? "–" : `${degrees}°`}
      </span>
      <span aria-hidden="true" className="text-small leading-tight text-jaga-text-2">
        <span className="block font-medium text-jaga-ink">{condition}</span>
        {/* The place, and the hour the reading is for once it is no longer current (rule 8). */}
        <span className="block">{stale ? t("modelTime", { time }) : place.name}</span>
      </span>
    </Link>
  );
}
