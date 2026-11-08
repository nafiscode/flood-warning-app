"use client";

import { useFormatter, useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { ForwardIcon } from "@/components/icons";
import { WeatherIcon } from "@/components/weather/WeatherIcon";
import { WeatherScene } from "@/components/weather/WeatherScene";
import type { MyPlaces } from "@/lib/me";
import { morningBrief, type MorningBrief as Brief } from "@/lib/morning-brief";
import { advisoriesFor, aheadOf, pickAdvisory } from "@/lib/weather-advisory";
import { useStored } from "@/lib/phone-store";
import { sunTimes } from "@/lib/sun";
import { useNow } from "@/lib/use-public";
import { useWeather, useWeatherPlace } from "@/lib/use-weather";
import { isStale, type WeatherHour } from "@/lib/weather";
import { isDaylight, SCENE_INK, SCENE_LOOKS, sceneFor, scrim } from "@/lib/weather-scene";
import styles from "./MorningBrief.module.css";

/**
 * Today's weather where the person lives, on the home screen (the owner's request, 8 Nov 2026):
 * what the day looks like, and the hours rain is expected - so there is a reason to open Jaga on
 * a quiet day, and the app is already familiar on the day it matters.
 *
 * What it is not: a flood warning. No alert level, no alert colour, no all-clear (safety rule
 * 10): the sky it paints is a sky, in the blues and slates of lib/weather-scene.ts, and the card
 * says in its own words that it is an Open-Meteo forecast with the time of the model data
 * (safety rule 8). It is drawn only on an ordinary day: at Warning or Evacuate the home screen
 * belongs to the alert, and HomeView does not render this at all.
 *
 * It asks the server for nothing of its own: the place and the last reading come from the same
 * phone storage and the same hook the header's weather chip uses, so on a slow connection the
 * card is there with what the phone already had - with the reading's own time on it, never as
 * though it were now.
 */
export function MorningBrief() {
  const locale = useLocale();
  const me = useStored<MyPlaces>("me");
  const { place } = useWeatherPlace(me, locale);
  const { weather } = useWeather(place, true);
  const now = useNow();
  const brief = morningBrief(weather, now);
  if (!place || !weather || !brief) return null;
  return (
    <MorningBriefView
      placeName={place.name}
      brief={brief}
      hours={weather.hours}
      lat={weather.lat}
      lon={weather.lon}
      modelIsDay={weather.isDay}
      now={now}
    />
  );
}

export type MorningBriefViewProps = {
  placeName: string;
  brief: Brief;
  /** The forecast's own hours: the severe-weather line is read from them. */
  hours: WeatherHour[];
  lat: number;
  lon: number;
  /** The reading's own day/night flag, used only where the sun's times cannot decide. */
  modelIsDay: boolean;
  /** The clock. Zero while this is still the server's HTML. */
  now: number;
};

/**
 * The card itself, with everything it draws handed to it: so a test can fix a day's weather and
 * read what the card says about it, without a browser or a forecast (tests/unit/morning-card).
 */
export function MorningBriefView({
  placeName,
  brief,
  hours,
  lat,
  lon,
  modelIsDay,
  now,
}: MorningBriefViewProps) {
  const t = useTranslations("brief");
  const tw = useTranslations("weather");
  const format = useFormatter();
  const at = now || Date.parse(brief.issuedAt);
  const isDay = isDaylight(at, lat, lon, modelIsDay, sunTimes);
  // The sky is the day's headline condition, not this minute's: the card is about what to expect
  // today, which is the whole point of it.
  const scene = sceneFor(brief.group, isDay);
  const look = SCENE_LOOKS[scene];
  const ink = SCENE_INK[look.ink];
  const clock = (iso: string) =>
    format.dateTime(new Date(iso), {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone: brief.timezone,
    });

  const head = t(
    brief.part === "morning"
      ? "headMorning"
      : brief.part === "afternoon"
        ? "headAfternoon"
        : "headEvening",
    { place: placeName },
  );
  const condition = tw(`codes.${brief.group}`);
  const rain = rainLine(brief, t, clock);
  /*
   * The same thresholds the notification uses (lib/weather-advisory.ts), so the card and the
   * phone say the same thing about the same day. Only the two the app's own forecast can judge:
   * the wind gust is asked for by the hourly severe-weather run and is not in this payload.
   */
  const severe = pickAdvisory(advisoriesFor(aheadOf(hours, now)));
  const severeLine =
    severe?.kind === "heavy_rain"
      ? t("heavyRain")
      : severe?.kind === "thunder"
        ? t("thunder")
        : null;
  const degrees = (value: number | null) => (value === null ? "–" : String(Math.round(value)));

  return (
    <section
      data-morning-brief={brief.dry ? "dry" : "rain"}
      className={`${styles.card} flex flex-col overflow-hidden rounded-2xl border border-jaga-line bg-jaga-surface`}
    >
      <div className="relative isolate px-5 pb-4 pt-4" data-brief-sky={scene}>
        <WeatherScene scene={scene} now={at} />
        {/* The veil that keeps the writing readable whatever the sky is doing. */}
        <div
          aria-hidden="true"
          className="absolute inset-0"
          style={{ background: scrim(look.ink) }}
        />
        <div className="relative flex flex-col gap-2" style={{ color: ink }}>
          <h2 className={`${styles.line} text-h3 font-bold`}>{head}</h2>
          <div className="flex items-center gap-4">
            <WeatherIcon
              group={brief.group}
              isDay={isDay}
              size={52}
              className={`${styles.temp} shrink-0`}
            />
            <div className="flex flex-col">
              <p className={`${styles.temp} text-[34px] font-bold leading-none tabular-nums`}>
                {t("range", { min: degrees(brief.minC), max: degrees(brief.maxC) })}
              </p>
              <p className={`${styles.line} ${styles.d1} font-medium`}>{condition}</p>
            </div>
          </div>
          <p className={`${styles.line} ${styles.d2} font-medium`}>{rain}</p>
          {/* Severe weather is said in words here, never by colour: the alert palette means a
              level, and this card never carries one (safety rules 8 and 10). */}
          {severeLine && (
            <p className={`${styles.line} ${styles.d2} font-bold`} data-brief-severe={severe?.kind}>
              {severeLine}
            </p>
          )}
          {/* One line of detail, and only when there is something to say. */}
          {!brief.dry && brief.rainMm > 0 && (
            <p className={`${styles.line} ${styles.d3}`}>
              {t("total", { mm: brief.rainMm })}
              {brief.chance === null
                ? ""
                : ` · ${t("chance", { percent: Math.round(brief.chance) })}`}
            </p>
          )}
        </div>
      </div>

      {/*
       * Where the forecast comes from, the hour of the model data it is built on, and that it is
       * not a Jaga alert. Off the sky and in the card's own ink, so it reads as a note and not as
       * part of the picture - and never left out (safety rule 8).
       */}
      <div className="flex flex-col gap-1 px-5 pb-4 pt-3 text-small text-jaga-muted">
        <p>{t("source", { time: clock(brief.issuedAt) })}</p>
        <p>{tw("notAnAlert")}</p>
        {isStale(brief.issuedAt, now) && now > 0 && <p>{tw("old")}</p>}
        <Link
          href="/weather"
          prefetch={false}
          className="mt-1 inline-flex min-h-tap items-center gap-1.5 self-start font-medium text-jaga-ink underline"
          data-brief-open="true"
        >
          {t("open")}
          <ForwardIcon size={18} className="rtl:-scale-x-100" />
        </Link>
      </div>
    </section>
  );
}

/**
 * The one line people read: when rain is expected today, or that none is. Kept here rather than
 * in lib/morning-brief.ts because it is words, and the words are chosen by the number of spells
 * the forecast holds - never machine-built from a template at runtime (CLAUDE.md, UI text).
 */
function rainLine(
  brief: Brief,
  t: (key: string, values?: Record<string, string | number>) => string,
  clock: (iso: string) => string,
): string {
  if (brief.dry) return t("dry");
  const [first, second] = brief.windows;
  if (!first) return t("dry");
  const line =
    second === undefined
      ? t("rainOne", { from: clock(first.from), until: clock(first.to) })
      : t("rainTwo", {
          from: clock(first.from),
          until: clock(first.to),
          from2: clock(second.from),
          until2: clock(second.to),
        });
  return brief.more ? `${line} · ${t("rainMore")}` : line;
}
