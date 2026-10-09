"use client";

import { useFormatter, useTranslations } from "next-intl";
import { ClockIcon, DropIcon, HouseIcon, ThermometerIcon, WindIcon } from "@/components/icons";
import { OpenMeteoAttribution } from "@/components/OpenMeteoAttribution";
import { Link } from "@/i18n/navigation";
import { buttonSecondary, card, errorNotice, hint, notice } from "@/lib/ui";
import {
  dayOffset,
  HOURS_LISTED,
  isStale,
  peakRain,
  placeDetail,
  weatherGroup,
  type Weather,
  type WeatherPlace,
} from "@/lib/weather";
import { PlacePicker } from "./PlacePicker";
import { WeatherIcon } from "./WeatherIcon";

export type WeatherViewProps = {
  /** False while this is still the server's HTML: the phone's storage isn't readable yet. */
  ready: boolean;
  place: WeatherPlace | null;
  /** The full tambon/district/province line, when the place comes from the chosen area. */
  detail: string | null;
  weather: Weather | null;
  fetchedAt: number | null;
  failed: boolean;
  /** The clock, moved on by useNow(), so an old reading says so without a reload. */
  now: number;
  picking: boolean;
  onPick: () => void;
  onChoose: (place: WeatherPlace) => void;
  onCancelPick: () => void;
  onRetry: () => void;
};

/**
 * The weather page (owner's request, 9 Oct 2026): now, the next 48 hours of rain, the next
 * 24 hours hour by hour, and seven days.
 *
 * It is ordinary weather, not a Jaga alert: the page says so in words, shows the time the model
 * data is from, names the source and credits Open-Meteo (safety rules 8 and 10, CLAUDE.md). It
 * carries no alert colours and no level badges, so it can never be mistaken for a warning.
 */
export function WeatherView(props: WeatherViewProps) {
  const { ready, place, detail, weather, failed, fetchedAt, now, picking } = props;
  const t = useTranslations("weather");
  const format = useFormatter();
  const zone = weather?.timezone ?? "Asia/Bangkok";
  const time = (iso: string) =>
    format.dateTime(new Date(iso), {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone: zone,
    });

  return (
    <div className="flex flex-col gap-5" data-weather-page="true">
      <BackHome label={t("backHome")} />
      <h1 className="text-h3 font-bold">{t("title")}</h1>

      {place && !picking && (
        <div className="flex flex-col gap-1">
          <p className="text-h3 font-bold" data-weather-place="true">
            {place.name}
          </p>
          {(detail ?? placeDetail(place)) && <p className={hint}>{detail ?? placeDetail(place)}</p>}
          <button type="button" onClick={props.onPick} className="min-h-tap self-start underline">
            {t("place.change")}
          </button>
        </div>
      )}

      {ready && (picking || !place) && (
        <section className={card}>
          <h2 className="text-h3 font-bold">{t("place.title")}</h2>
          <p className={hint}>{t("place.body")}</p>
          <PlacePicker
            onChoose={props.onChoose}
            onCancel={place && picking ? props.onCancelPick : undefined}
          />
        </section>
      )}

      {place && !weather && (
        <p className={ready && failed ? errorNotice : notice} role={failed ? "alert" : undefined}>
          {!ready ? t("loading") : failed ? t("unavailable") : t("loading")}
        </p>
      )}
      {place && !weather && ready && failed && (
        <button type="button" onClick={props.onRetry} className={buttonSecondary}>
          {t("retry")}
        </button>
      )}

      {weather && (
        <>
          <div className="flex flex-col gap-5 lg:grid lg:grid-cols-2 lg:items-start">
            <Now weather={weather} />
            {failed && (
              <p className={notice} role="status">
                {t("offline", { time: time(weather.at) })}
              </p>
            )}
            <RainBars weather={weather} />
            <Hours weather={weather} />
            <Days weather={weather} />
          </div>
          <section className="flex flex-col gap-2">
            <p className="inline-flex items-center gap-2 text-small text-jaga-text-2">
              <ClockIcon size={20} />
              <span>{t("modelTime", { time: time(weather.at) })}</span>
            </p>
            {fetchedAt && (
              <p className={hint}>
                {t("checked", { time: time(new Date(fetchedAt).toISOString()) })}
              </p>
            )}
            {isStale(weather.at, now) && <p className={notice}>{t("old")}</p>}
            {/* Never a forecast as certain, and never confused with a Jaga alert (rules 8, 10). */}
            <p className={notice}>{t("notAnAlert")}</p>
            <p className={hint}>{t("coverage")}</p>
            <OpenMeteoAttribution />
          </section>
        </>
      )}

      <BackHome label={t("backHome")} />
    </div>
  );
}

/** The way back, at the top and at the bottom: the page can be opened from the header anywhere. */
function BackHome({ label }: { label: string }) {
  return (
    <Link
      href="/"
      prefetch={false}
      // Full width on a phone, a button-sized button where there is room.
      className={`${buttonSecondary} gap-2 sm:w-auto sm:self-start sm:px-8`}
      data-weather-back="true"
    >
      <HouseIcon size={22} />
      {label}
    </Link>
  );
}

function Now({ weather }: { weather: Weather }) {
  const t = useTranslations("weather");
  const format = useFormatter();
  const group = weatherGroup(weather.code);
  const n = (value: number, digits = 0) =>
    format.number(value, { maximumFractionDigits: digits, minimumFractionDigits: 0 });

  return (
    <section className={card} data-weather-now="true">
      <h2 className="text-h3 font-bold">{t("now")}</h2>
      <div className="flex items-center gap-4">
        <WeatherIcon
          group={group}
          isDay={weather.isDay}
          size={56}
          className="shrink-0 text-jaga-teal-ink"
        />
        <div className="flex flex-col">
          <p className="text-[40px] font-bold leading-none tabular-nums">
            {weather.tempC === null ? "–" : `${n(weather.tempC)}°C`}
          </p>
          <p className="font-medium">{t(`codes.${group}`)}</p>
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-3">
        {weather.feelsC !== null && (
          <Fact icon={<ThermometerIcon size={20} />} label={t("feels")}>
            {`${n(weather.feelsC)}°C`}
          </Fact>
        )}
        <Fact icon={<DropIcon size={20} />} label={t("rainNow")}>
          {t("mm", { value: n(weather.rainMm, 1) })}
        </Fact>
        {weather.humidity !== null && (
          <Fact icon={<DropIcon size={20} />} label={t("humidity")}>
            {`${n(weather.humidity)}%`}
          </Fact>
        )}
        {weather.windKmh !== null && (
          <Fact icon={<WindIcon size={20} />} label={t("wind")}>
            {weather.windFrom
              ? t("windFrom", {
                  speed: n(weather.windKmh),
                  from: t(`compass.${weather.windFrom}`),
                })
              : t("kmh", { value: n(weather.windKmh) })}
          </Fact>
        )}
      </dl>
    </section>
  );
}

function Fact({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="inline-flex items-center gap-2 text-small text-jaga-text-2">
        <span className="text-jaga-text-2">{icon}</span>
        {label}
      </dt>
      <dd className="font-medium tabular-nums">{children}</dd>
    </div>
  );
}

/** Rain expected hour by hour for 48 hours, as bars. The numbers are in the hourly list too. */
function RainBars({ weather }: { weather: Weather }) {
  const t = useTranslations("weather");
  const format = useFormatter();
  const hours = weather.hours;
  if (hours.length === 0) return null;
  const peak = peakRain(hours);
  const total = hours.reduce((sum, h) => sum + h.rainMm, 0);
  const n = (value: number, digits = 1) => format.number(value, { maximumFractionDigits: digits });
  const hour = (iso: string) =>
    format.dateTime(new Date(iso), {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone: weather.timezone,
    });
  /** "today", "tomorrow", "the day after"; any further out is named by its date. */
  const dayWord = (iso: string) => {
    const offset = dayOffset(iso, hours[0]!.at, weather.timezone);
    if (offset === 0) return t("days.today");
    if (offset === 1) return t("days.tomorrow");
    if (offset === 2) return t("days.dayAfter");
    return format.dateTime(new Date(iso), {
      day: "numeric",
      month: "short",
      timeZone: weather.timezone,
    });
  };

  return (
    <section className={card} data-weather-rain="true">
      <h2 className="text-h3 font-bold">{t("rain.title")}</h2>
      <p className="font-medium tabular-nums">{t("rain.total", { value: n(total) })}</p>
      <div
        role="img"
        aria-label={t("rain.chart", { value: n(total), hours: hours.length })}
        className="flex h-24 items-end gap-px"
      >
        {hours.map((h) => (
          <span
            key={h.at}
            title={`${hour(h.at)} · ${t("mm", { value: n(h.rainMm) })}`}
            className="flex-1 rounded-t bg-jaga-teal"
            // At least a hairline, so a dry hour is still a tick on the axis, not a gap.
            style={{ height: `${Math.max(2, Math.round((h.rainMm / peak) * 100))}%` }}
          />
        ))}
      </div>
      {/*
        The day under each time: three bare clock times across 48 hours ("17:00, 17:00, 16:00")
        read as nonsense (the owner, 9 Oct).
      */}
      <div className="flex justify-between gap-2 text-small text-jaga-text-2">
        {[0, Math.floor(hours.length / 2), hours.length - 1].map((index, place) => {
          const at = hours[index]!.at;
          return (
            <span
              key={at}
              className={`flex flex-col ${place === 1 ? "items-center" : place === 2 ? "items-end" : "items-start"}`}
            >
              <span className="tabular-nums">{hour(at)}</span>
              <span>{dayWord(at)}</span>
            </span>
          );
        })}
      </div>
      <p className={hint}>{t("rain.scale", { value: n(peak) })}</p>
    </section>
  );
}

function Hours({ weather }: { weather: Weather }) {
  const t = useTranslations("weather");
  const format = useFormatter();
  const hours = weather.hours.slice(0, HOURS_LISTED);
  if (hours.length === 0) return null;
  const n = (value: number, digits = 0) => format.number(value, { maximumFractionDigits: digits });

  return (
    <section className={card} data-weather-hours="true">
      <h2 className="text-h3 font-bold">{t("hours.title")}</h2>
      {/*
        A grid, not a sideways strip: a strip let the whole page be panned at 360 px (measured),
        and anything off the edge is easy to miss on a cheap phone. Six rows of four fit.
      */}
      <ul className="grid grid-cols-4 gap-1 sm:grid-cols-6 lg:grid-cols-8">
        {hours.map((h) => {
          const group = weatherGroup(h.code);
          return (
            <li
              key={h.at}
              className="flex min-w-0 flex-col items-center gap-1 rounded-xl bg-jaga-ground px-1 py-2 text-center"
            >
              <span className="text-small tabular-nums text-jaga-text-2">
                {format.dateTime(new Date(h.at), {
                  hour: "2-digit",
                  minute: "2-digit",
                  hourCycle: "h23",
                  timeZone: weather.timezone,
                })}
              </span>
              <WeatherIcon group={group} isDay={h.isDay} size={24} className="text-jaga-teal-ink" />
              <span className="sr-only">{t(`codes.${group}`)}</span>
              <span className="font-medium tabular-nums">
                {h.tempC === null ? "–" : `${n(h.tempC)}°`}
              </span>
              <span className="text-small tabular-nums text-jaga-text-2">
                {h.chance === null ? "–" : `${n(h.chance)}%`}
              </span>
            </li>
          );
        })}
      </ul>
      <p className={hint}>{t("hours.chance")}</p>
    </section>
  );
}

function Days({ weather }: { weather: Weather }) {
  const t = useTranslations("weather");
  const format = useFormatter();
  if (weather.days.length === 0) return null;
  const n = (value: number, digits = 0) => format.number(value, { maximumFractionDigits: digits });

  return (
    <section className={card} data-weather-days="true">
      <h2 className="text-h3 font-bold">{t("days.title")}</h2>
      <ul className="flex flex-col divide-y divide-jaga-line">
        {weather.days.map((day, index) => {
          const group = weatherGroup(day.code);
          const when = new Date(day.at);
          return (
            // Two lines per day: at 360 px a single row left the condition truncated.
            <li key={day.date} className="flex flex-col gap-1 py-3">
              <div className="flex items-center gap-2">
                <p className="font-medium">
                  {index === 0
                    ? t("days.today")
                    : index === 1
                      ? t("days.tomorrow")
                      : format.dateTime(when, { weekday: "short", timeZone: weather.timezone })}
                </p>
                <p className="text-small tabular-nums text-jaga-text-2">
                  {format.dateTime(when, {
                    day: "numeric",
                    month: "short",
                    timeZone: weather.timezone,
                  })}
                </p>
                <span className="ms-auto inline-flex items-center gap-2">
                  <WeatherIcon group={group} size={26} className="shrink-0 text-jaga-teal-ink" />
                  <span className="font-medium tabular-nums">
                    {day.maxC === null ? "–" : `${n(day.maxC)}°`}
                    <span className="text-jaga-text-2">
                      {" / "}
                      {day.minC === null ? "–" : `${n(day.minC)}°`}
                    </span>
                  </span>
                </span>
              </div>
              <p className="text-small text-jaga-text-2">
                {t(`codes.${group}`)} ·{" "}
                <span className="tabular-nums">
                  {t("days.rain", {
                    value: n(day.rainMm, 1),
                    chance: day.chance === null ? "–" : n(day.chance),
                  })}
                </span>
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
