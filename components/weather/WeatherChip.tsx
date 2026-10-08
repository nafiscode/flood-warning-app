"use client";

import { useFormatter, useLocale, useTranslations } from "next-intl";
import { CloudIcon } from "@/components/icons";
import { Link, usePathname } from "@/i18n/navigation";
import type { MyPlaces } from "@/lib/me";
import { useStored } from "@/lib/phone-store";
import { useNow } from "@/lib/use-public";
import { useWeather, useWeatherPlace } from "@/lib/use-weather";
import { isStale, weatherGroup } from "@/lib/weather";
import { WeatherIcon } from "./WeatherIcon";

/** Nothing is fetched on the SOS screens: there, only the request matters (safety rule 1). */
const QUIET = /^\/sos(\/|$)/;

/**
 * The weather in the header: condition, temperature, and the place on a wide screen. A tap opens
 * the weather page. It reads the place and the last reading from the phone's own storage, so it
 * draws immediately and still says something with no connection — then with the time of the
 * reading, never as if it were now.
 *
 * It asks nothing of the server by itself: the signed-in home comes from what the home screen
 * already stored, and the forecast request waits for an idle moment (lib/use-weather.ts).
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
  const { weather } = useWeather(place, !QUIET.test(pathname));
  const now = useNow();

  // Tight on purpose: at 360 px the three language names leave 65 px beside them, and a wider
  // chip pushes "English" onto a line of its own and makes the frozen header 48 px taller.
  const shared = `min-h-tap items-center gap-1 rounded px-1 text-small font-medium text-white underline lg:gap-1.5 lg:px-2 ${className}`;

  if (!place || !weather) {
    return (
      <Link
        href="/weather"
        prefetch={false}
        className={shared}
        data-weather-chip="empty"
        data-weather-slot={where}
      >
        <CloudIcon size={20} className="text-jaga-teal-light" />
        <span>{t("chip.label")}</span>
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

  return (
    <Link
      href="/weather"
      prefetch={false}
      className={shared}
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
      <WeatherIcon
        group={group}
        isDay={weather.isDay}
        size={20}
        className="shrink-0 text-jaga-teal-light"
      />
      <span aria-hidden="true">{degrees === null ? "–" : `${degrees}°`}</span>
      {/* The hour of an old reading is shown, so a cold number is never read as "now". */}
      {stale && (
        <span aria-hidden="true" className="text-jaga-teal-light">
          {time}
        </span>
      )}
      <span aria-hidden="true" className="hidden max-w-32 truncate lg:inline">
        {place.name}
      </span>
    </Link>
  );
}
