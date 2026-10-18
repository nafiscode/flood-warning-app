"use client";

import { useFormatter, useLocale, useTranslations } from "next-intl";
import { CloudIcon } from "@/components/icons";
import { Link, usePathname } from "@/i18n/navigation";
import type { MyPlaces } from "@/lib/me";
import { useStored } from "@/lib/phone-store";
import { useNow } from "@/lib/use-public";
import { useWeather, useWeatherPlace } from "@/lib/use-weather";
import { isStale, weatherGroup } from "@/lib/weather";
import { sunTimes } from "@/lib/sun";
import { isDaylight, SCENE_INK, SCENE_LOOKS, sceneFor, scrim } from "@/lib/weather-scene";
import styles from "./WeatherChip.module.css";
import { WeatherIcon } from "./WeatherIcon";

/** Nothing is fetched on the SOS screens: there, only the request matters (safety rule 1). */
const QUIET = /^\/sos(\/|$)/;

/** The sky of the header itself, for the chip that has no weather to show yet. */
const NO_SKY = { top: "#2B4F6C", bottom: "#3F6F8C", veil: "rgba(9, 20, 30, 0)" };

/**
 * The weather in the header: a small window of the sky as it is now, with the temperature in
 * it, and the place and an arrow on a wide screen. A tap opens the weather page.
 *
 * It is drawn as a pill with the sky inside it, not as a line of underlined text: the owner
 * found (13 Oct) that nothing about the old one said "this opens a page". The sky is the same
 * one the weather page opens on, under the same veil, so the writing keeps its contrast on
 * every sky (tests/unit/weather-scene.test.tsx holds that to 4.5:1).
 *
 * It reads the place and the last reading from the phone's own storage, so it draws immediately
 * and still says something with no connection — then with the time of the reading, never as if
 * it were now. It asks nothing of the server by itself: the signed-in home comes from what the
 * home screen already stored, and the forecast request waits for an idle moment.
 */
export function WeatherChip({
  className = "inline-flex",
  where = "row",
}: {
  className?: string;
  /** Holds the display class too (`hidden lg:inline-flex`): the base must not set one, or it
   * would win over `hidden` — two utilities of the same specificity, decided by their order in
   * the stylesheet, not by the order they are written here. */
  where?: "header" | "row";
}) {
  const t = useTranslations("weather");
  const locale = useLocale();
  const format = useFormatter();
  const pathname = usePathname();
  const me = useStored<MyPlaces>("me");
  const { place } = useWeatherPlace(me, locale);
  const quiet = QUIET.test(pathname);
  const { weather } = useWeather(place, !quiet);
  const now = useNow();

  // The link is the 48 px tap target; the pill inside it is the part that is drawn. On a phone
  // it sits at the far end of the top row, beside the clock and the bell (the owner, 13 Oct),
  // where there is room for the arrow as well; the place's name still waits for a wide screen.
  const link = `${styles.link} ${quiet ? styles.quiet : ""} min-h-tap items-center rounded-full ${className}`;
  const pill = `${styles.pill} inline-flex h-8 items-center gap-1 rounded-full px-2 text-small font-medium lg:gap-1.5 lg:px-3`;

  if (!place || !weather) {
    return (
      <Link
        href="/weather"
        prefetch={false}
        className={link}
        data-weather-chip="empty"
        data-weather-slot={where}
      >
        <span
          className={`${pill} text-white`}
          style={
            {
              "--chip-sky-top": NO_SKY.top,
              "--chip-sky-bottom": NO_SKY.bottom,
              "--chip-veil": NO_SKY.veil,
            } as React.CSSProperties
          }
        >
          <CloudIcon size={18} className={`${styles.icon} shrink-0`} />
          {/*
            The word "weather" is read out but not drawn at phone width (18 Oct): at 360 px in
            Thai it made this pill 150 px wide, and with the theme switch beside the bell the top
            row no longer fitted next to the logo - the header grew by a row for exactly the
            visitor who has not chosen a place yet. The cloud and the arrow still say it is
            somewhere to go, and the words come back from a tablet up.
          */}
          <span className="sr-only sm:not-sr-only">{t("chip.label")}</span>
          <Arrow />
        </span>
      </Link>
    );
  }

  const group = weatherGroup(weather.code);
  const condition = t(`codes.${group}`);
  const degrees = weather.tempC === null ? null : Math.round(weather.tempC);
  // Before the phone's clock is readable (the server's HTML) nothing is called stale.
  const stale = now > 0 && isStale(weather.at, now);
  const time = format.dateTime(new Date(weather.at), {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: weather.timezone,
  });
  const isDay = isDaylight(
    now || Date.parse(weather.at),
    weather.lat,
    weather.lon,
    weather.isDay,
    sunTimes,
  );
  const scene = sceneFor(group, isDay);
  const look = SCENE_LOOKS[scene];

  return (
    <Link
      href="/weather"
      prefetch={false}
      className={link}
      data-weather-chip="reading"
      data-weather-slot={where}
      // One sentence for a screen reader: the condition in words, never the icon alone.
      aria-label={
        degrees === null
          ? t("chip.readingNoTemp", { condition, place: place.name })
          : stale
            ? t("chip.readingAt", { condition, degrees, place: place.name, time })
            : t("chip.reading", { condition, degrees, place: place.name })
      }
    >
      <span
        className={pill}
        data-weather-chip-sky={scene}
        style={
          {
            color: SCENE_INK[look.ink],
            "--chip-sky-top": look.sky[0],
            "--chip-sky-bottom": look.sky[1],
            "--chip-veil": scrim(look.ink),
          } as React.CSSProperties
        }
      >
        <WeatherIcon group={group} isDay={isDay} size={18} className={`${styles.icon} shrink-0`} />
        <span aria-hidden="true" className="font-bold tabular-nums">
          {degrees === null ? "–" : `${degrees}°`}
        </span>
        {/* The hour of an old reading is shown, so a cold number is never read as "now". */}
        {stale && (
          <span aria-hidden="true" className="tabular-nums opacity-80">
            {time}
          </span>
        )}
        <span aria-hidden="true" className="hidden max-w-36 truncate lg:inline">
          {place.name}
        </span>
        <Arrow />
      </span>
    </Link>
  );
}

/** "This goes somewhere." */
function Arrow() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`${styles.arrow} shrink-0`}
    >
      <path d="M4 2l4 4-4 4" />
    </svg>
  );
}
