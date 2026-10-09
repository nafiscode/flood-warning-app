"use client";

import { useFormatter, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import {
  DropIcon,
  PauseIcon,
  PlayIcon,
  RainIcon,
  ThermometerIcon,
  WindIcon,
} from "@/components/icons";
import type { MinePlace } from "@/components/map/MapView";
import { card, hint, notice } from "@/lib/ui";
import { dayOffset } from "@/lib/weather";
import {
  FIELD_UNITS,
  nearestPoint,
  RAMPS,
  valueAt,
  WEATHER_FIELDS,
  type WeatherField,
  type WeatherGrid,
} from "@/lib/weather-grid";

export type WeatherMapsViewProps = {
  grid: WeatherGrid | null;
  state: "loading" | "ok" | "unavailable";
  field: WeatherField;
  onField: (field: WeatherField) => void;
  hour: number;
  onHour: (hour: number) => void;
  /** The hours play round on their own until someone stops them. */
  playing: boolean;
  onPlaying: (playing: boolean) => void;
  /** The person's own places, with the place the page is about first. */
  places: MinePlace[];
  /** The map itself; a test or an example can put something else here. */
  canvas: ReactNode;
};

const ICONS = {
  rain: RainIcon,
  temp: ThermometerIcon,
  humidity: DropIcon,
  wind: WindIcon,
} as const;

/**
 * The weather maps (owner's request, 9 Oct 2026): one map, with buttons for rain, temperature,
 * humidity and wind, and a slider through the next 24 hours.
 *
 * Everything on it is a forecast from a model, so it always says which hour it is drawing, how
 * wide a cell is, and the page around it names the source and says it is not a Jaga alert
 * (safety rule 8). No alert colour is used by any of the four maps (lib/weather-grid.ts).
 */
export function WeatherMapsView(props: WeatherMapsViewProps) {
  const { grid, state, field, hour, places } = props;
  const t = useTranslations("weather");
  const format = useFormatter();
  const zone = grid?.timezone ?? "Asia/Bangkok";
  const at = grid?.hours[hour] ?? null;
  const km = grid ? Math.round(grid.step * 111) : null;

  const hourLabel = (iso: string) => {
    const time = format.dateTime(new Date(iso), {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone: zone,
    });
    const offset = grid ? dayOffset(iso, grid.hours[0]!, zone) : 0;
    const day =
      offset === 0 ? t("days.today") : offset === 1 ? t("days.tomorrow") : t("days.dayAfter");
    return `${time} ${day}`;
  };

  return (
    <section className={card} data-weather-maps="true">
      <h2 className="text-h3 font-bold">{t("map.title")}</h2>

      {/*
        One column on a phone, in this order: the buttons, the map, then what it means. On a
        laptop the map fills the left and everything that drives it stands beside it, so neither
        is squeezed and the two sides end level.
      */}
      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)] lg:grid-rows-[auto_1fr] lg:gap-5">
        {/* One map, four fields: a radio group, because only one can be drawn at a time. */}
        <div
          role="radiogroup"
          aria-label={t("map.fieldLabel")}
          className="grid grid-cols-2 gap-2 lg:col-start-2 lg:row-start-1"
        >
          {WEATHER_FIELDS.map((name) => {
            const Icon = ICONS[name];
            const on = name === field;
            return (
              <button
                key={name}
                type="button"
                role="radio"
                aria-checked={on}
                data-weather-field={name}
                onClick={() => props.onField(name)}
                className={`inline-flex min-h-tap items-center justify-center gap-2 rounded-xl border-2 px-3 py-2 font-medium ${
                  on
                    ? "border-jaga-teal-ink bg-jaga-ground text-jaga-teal-ink"
                    : "border-jaga-line bg-jaga-surface text-jaga-text"
                }`}
              >
                <Icon size={22} />
                {t(`map.fields.${name}`)}
              </button>
            );
          })}
        </div>

        <div className="lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:h-full">{props.canvas}</div>

        <div className="flex flex-col gap-4 lg:col-start-2 lg:row-start-2">
          {state === "unavailable" && (
            <p role="alert" className={notice}>
              {t("map.unavailable")}
            </p>
          )}

          {/* The hour on the map. It plays round on its own; the label says which hour. */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="weather-map-hour" className="font-medium">
                {at ? t("map.showing", { when: hourLabel(at) }) : t("map.loading")}
              </label>
              <button
                type="button"
                data-weather-play={props.playing ? "on" : "off"}
                aria-pressed={props.playing}
                onClick={() => props.onPlaying(!props.playing)}
                className="inline-flex min-h-tap min-w-tap items-center justify-center gap-2 rounded-xl border-2 border-jaga-line px-3 text-small font-medium"
              >
                {props.playing ? <PauseIcon size={20} /> : <PlayIcon size={20} />}
                {t(props.playing ? "map.pause" : "map.play")}
              </button>
            </div>
            <input
              id="weather-map-hour"
              type="range"
              min={0}
              max={Math.max(0, (grid?.hours.length ?? 1) - 1)}
              step={1}
              value={hour}
              disabled={!grid}
              data-weather-hour={hour}
              aria-valuetext={at ? hourLabel(at) : undefined}
              onChange={(event) => props.onHour(Number(event.target.value))}
              className="h-tap w-full accent-jaga-teal-ink"
            />
            <div className="flex justify-between text-small tabular-nums text-jaga-text-2">
              <span>{t("map.now")}</span>
              <span>{grid ? t("map.inHours", { hours: grid.hours.length - 1 }) : ""}</span>
            </div>
          </div>

          <Legend field={field} />

          {field === "wind" && <p className={hint}>{t("map.windNote")}</p>}

          {/* What the map says at the person's own places, in numbers, for anyone who can't
              read a colour off a map. */}
          {grid && places.length > 0 && (
            <div className="flex flex-col gap-1">
              <h3 className="font-medium">{t("map.myPlaces")}</h3>
              <ul
                className="flex flex-col divide-y divide-jaga-line"
                data-weather-map-values="true"
              >
                {places.map((place) => {
                  const point = nearestPoint(grid, place.lat, place.lon);
                  const value = point === null ? null : valueAt(grid, field, point, hour);
                  return (
                    <li key={place.id} className="flex items-center justify-between gap-3 py-2">
                      <span className="inline-flex min-w-0 items-center gap-2">
                        <span
                          aria-hidden="true"
                          className="size-3 shrink-0 rounded-full border-2"
                          style={{ borderColor: place.color, background: place.color }}
                        />
                        <span className="truncate">{place.label}</span>
                      </span>
                      <span className="shrink-0 font-medium tabular-nums">
                        {value === null
                          ? t("map.offGrid")
                          : `${format.number(value, {
                              maximumFractionDigits: FIELD_UNITS[field].digits,
                            })} ${FIELD_UNITS[field].unit}`}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {km !== null && <p className={hint}>{t("map.cellSize", { km })}</p>}
        </div>
      </div>
    </section>
  );
}

/** The colour scale, with the same numbers the cells are coloured by. */
function Legend({ field }: { field: WeatherField }) {
  const t = useTranslations("weather");
  const format = useFormatter();
  const stops = RAMPS[field];
  const { unit, digits } = FIELD_UNITS[field];
  const n = (value: number) => format.number(value, { maximumFractionDigits: digits });
  return (
    <div className="flex flex-col gap-1" data-weather-legend={field}>
      <p className="text-small font-medium">{t(`map.legend.${field}`)}</p>
      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-small tabular-nums text-jaga-text-2">
        {stops.map(([from, color], index) => {
          const to = stops[index + 1]?.[0];
          // The lowest band of a scale that starts far below anything real is written "under x".
          const label =
            index === 0 && from <= -50
              ? t("map.under", { value: n(to ?? 0) })
              : to === undefined
                ? t("map.over", { value: n(from) })
                : `${n(from)}–${n(to)}`;
          return (
            <li key={color} className="inline-flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="size-3 rounded-sm border border-jaga-line"
                style={{ background: color }}
              />
              {label}
            </li>
          );
        })}
        <li className="font-medium">{unit}</li>
      </ul>
    </div>
  );
}
