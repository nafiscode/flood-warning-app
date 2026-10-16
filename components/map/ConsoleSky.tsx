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
import { isDaylight, SCENE_LOOKS, sceneFor, type Scene } from "@/lib/weather-scene";
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

/**
 * The moving sky itself, behind everything on the console. It goes in as the first child of the
 * console, and the rest of the console is lifted above it in app/globals.css.
 */
export function ConsoleSky() {
  const sky = useConsoleWeather();
  if (!sky) return null;
  const veil = consoleVeil(SCENE_LOOKS[sky.scene].sky);
  return (
    /*
     * Nothing of this exists below the console's own breakpoint: `hidden` is display:none, so on
     * a phone the sky is not drawn, not animated and not in the way of anything.
     */
    <div
      data-console-sky={sky.scene}
      aria-hidden="true"
      className="hidden console:block"
      /*
       * How much of this sky may show: the lightest veil that still leaves the console's weakest
       * text at 4.5:1 on it (lib/map-console.ts). A clear day comes through as a blue sky; a
       * thunderstorm is held further back, because its sky is dark enough to swallow grey text.
       * Both are given, and the stylesheet takes the one for the theme the clock has set.
       */
      style={
        {
          "--veil-day": veil.light,
          "--veil-night": veil.dark,
        } as React.CSSProperties
      }
    >
      <WeatherScene scene={sky.scene} now={sky.now} />
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
      className="hidden min-h-tap items-center gap-2 rounded-full text-jaga-ink no-underline console:ms-auto console:inline-flex"
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
