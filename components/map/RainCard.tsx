"use client";

import { useFormatter, useTranslations } from "next-intl";
import { OpenMeteoAttribution } from "@/components/OpenMeteoAttribution";
import type { RainKind } from "@/lib/place-rain";
import { useFetched } from "@/lib/use-public";
import { DRY_MM, roundCoord, weatherGroup, type Weather, type WeatherGroup } from "@/lib/weather";
import { MoreButton } from "./MapPeek";

/** The weather widget's word for each kind of cloud (lib/place-rain.ts follows the same groups). */
export const RAIN_GROUP: Record<RainKind, WeatherGroup> = {
  drizzle: "drizzle",
  light: "rainLight",
  rain: "rain",
  heavy: "rainHeavy",
  showers: "showers",
  showersHeavy: "showersHeavy",
  thunder: "thunder",
  hail: "thunderHail",
};

/** Hours shown under "the next hours". */
export const RAIN_HOURS = 6;

/** Kept here as well, where it was first written, so older imports still find it. */
export { DRY_MM };

const BANGKOK_HOUR = {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "Asia/Bangkok",
} as const satisfies Intl.DateTimeFormatOptions;

export const weatherUrl = (lat: number, lon: number) =>
  `/api/public/weather?lat=${roundCoord(lat)}&lon=${roundCoord(lon)}`;

/** The coming hours from now on, and the first of them the model has dry (null: rain all along). */
export function rainAhead(
  weather: Pick<Weather, "hours">,
  now: number,
): { hours: Weather["hours"]; easesAt: string | null } {
  const hours = weather.hours
    .filter((h) => Date.parse(h.at) > now - 3_600_000)
    .slice(0, RAIN_HOURS);
  const dry = hours.find((h) => h.rainMm < DRY_MM);
  return { hours, easesAt: dry?.at ?? null };
}

/**
 * The pop-up on a rain cloud (the owner, 15 Oct): whose place, and what is falling there now,
 * with the button down to the rain's own section under the map. Over a reservoir (21 Oct) the
 * heading names the lake and a line says why the rain there matters - it is what raises the
 * water. What the lake is doing is still the dam's own figures, never this (safety rule 8).
 */
export function RainPeek({
  name,
  kind,
  reservoir = false,
  onMore,
}: {
  name: string;
  kind: RainKind;
  reservoir?: boolean;
  onMore: () => void;
}) {
  const t = useTranslations("mapRain");
  const tCodes = useTranslations("weather.codes");
  return (
    <div
      className="flex flex-col gap-1 text-jaga-text"
      data-peek="rain"
      data-peek-rain={kind}
      data-peek-reservoir={reservoir ? "true" : undefined}
    >
      <b>{reservoir ? t("overReservoir", { place: name }) : name}</b>
      <p className="font-medium">{t("now", { what: tCodes(RAIN_GROUP[kind]) })}</p>
      <p className="text-small text-jaga-text-2">
        {reservoir ? t("reservoirNote") : t("peekNote")}
      </p>
      <MoreButton onMore={onMore} />
    </div>
  );
}

/**
 * The rain over one of the person's own places, under the map: what is falling now and the next
 * few hours from the same forecast the weather page uses, with the model's time and what it is
 * not (safety rule 8). Asked for only once the section is opened; the answer is the edge's copy
 * for that rounded point, the same for everyone.
 */
export function RainSection({
  name,
  lat,
  lon,
  kind,
  reservoir = false,
  now,
}: {
  name: string;
  lat: number;
  lon: number;
  kind: RainKind;
  /** Over a dam's lake rather than one of the person's own places (the owner, 21 Oct). */
  reservoir?: boolean;
  now: number;
}) {
  const t = useTranslations("mapRain");
  const tCodes = useTranslations("weather.codes");
  const format = useFormatter();
  const { data, state } = useFetched<Weather>(weatherUrl(lat, lon));
  const time = (iso: string) => format.dateTime(new Date(iso), BANGKOK_HOUR);
  const ahead = data ? rainAhead(data, now) : null;
  const nowGroup = data?.code !== null && data?.code !== undefined ? weatherGroup(data.code) : null;
  return (
    <section
      className="flex flex-col gap-3 rounded-2xl border border-jaga-line bg-jaga-surface p-5"
      data-rain-section={kind}
      data-rain-reservoir={reservoir ? "true" : undefined}
      aria-labelledby="rain-title"
    >
      <h2 id="rain-title" className="text-h3 font-bold text-jaga-ink">
        {reservoir ? t("overReservoir", { place: name }) : t("title", { place: name })}
      </h2>
      <p className="font-medium" data-rain-now="true">
        {t("now", { what: tCodes(nowGroup ?? RAIN_GROUP[kind]) })}
      </p>
      {!data && state === "loading" && <p>{t("loading")}</p>}
      {((!data && state === "unavailable") || (ahead && ahead.hours.length === 0)) && (
        // No answer, or one too old to have any hour ahead of now: nothing is shown as current.
        <p data-rain-failed="true">{t("failed")}</p>
      )}
      {data && ahead && ahead.hours.length > 0 && (
        <>
          <p data-rain-eases={ahead.easesAt ? "yes" : "no"}>
            {ahead.easesAt
              ? t("eases", { time: time(ahead.easesAt) })
              : t("continues", { hours: ahead.hours.length })}
          </p>
          <div className="flex flex-col gap-1">
            <p className="font-bold text-jaga-ink">{t("next", { hours: ahead.hours.length })}</p>
            <ul className="flex flex-col" data-rain-hours="true">
              {ahead.hours.map((h) => (
                <li
                  key={h.at}
                  className="grid grid-cols-[4rem_1fr_auto] gap-2 border-t border-jaga-line py-1.5 first:border-t-0"
                >
                  <span className="font-medium">{time(h.at)}</span>
                  <span>{tCodes(weatherGroup(h.code))}</span>
                  <span className="text-end tabular-nums">
                    {t("amount", { mm: h.rainMm.toFixed(1), chance: h.chance ?? 0 })}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <p className="text-small text-jaga-text-2">{t("modelTime", { time: time(data.at) })}</p>
        </>
      )}
      {reservoir && (
        <p className="text-small text-jaga-text-2" data-rain-fills="true">
          {t("reservoirFills")}
        </p>
      )}
      <p className="rounded-lg bg-jaga-ground p-3 text-small">{t("note")}</p>
      <OpenMeteoAttribution />
    </section>
  );
}
