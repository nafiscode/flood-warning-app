"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { agreement, HOURS, sumRain, type TmdForecast } from "@/lib/tmd-forecast";
import { card, hint, notice } from "@/lib/ui";
import type { Weather, WeatherPlace } from "@/lib/weather";
import { roundCoord } from "@/lib/weather";

/**
 * Two forecasts of the same rain, side by side (owner, 18 Nov 2026): Open-Meteo's global model and
 * TMD's own 3 km model, each with its total for the next 24 hours.
 *
 * This is safety rule 8 made visible. A single number invites certainty; two numbers from two
 * models show what is actually known. When they agree the card says so in one line and a reader
 * can lean on the figure. When they are far apart the card says that too - and says to plan for
 * the higher one, because on a flood app the cost of being ready for rain that does not come is
 * not the cost of being caught by rain that does.
 *
 * It carries no level and no alert colour (safety rule 10), and it is drawn only when TMD's model
 * actually answers: without the token, or when TMD is unreachable, the page is exactly as it was.
 */
export function TwoForecasts({
  place,
  weather,
}: {
  place: WeatherPlace | null;
  weather: Weather | null;
}) {
  const [tmd, setTmd] = useState<TmdForecast | null>(null);

  useEffect(() => {
    if (!place) return;
    let live = true;
    const url = `/api/public/tmd/forecast?lat=${roundCoord(place.lat)}&lon=${roundCoord(place.lon)}`;
    fetch(url, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status));
        return response.json() as Promise<TmdForecast>;
      })
      .then((forecast) => {
        if (live) setTmd(forecast);
      })
      // No token, rate-limited, or TMD down: no second opinion, no card, nothing said about it.
      .catch(() => {
        if (live) setTmd(null);
      });
    return () => {
      live = false;
    };
  }, [place]);

  if (!tmd || !weather) return null;
  // Both totals must cover the same hours, or the comparison is meaningless. TMD's forecast
  // starts at its own first hour, and Open-Meteo's is summed from the same instant.
  const from = Date.parse(tmd.hours[0]!.at);
  if (!Number.isFinite(from)) return null;
  const openMeteoMm = sumRain(weather.hours, from, HOURS);
  return <TwoForecastsView openMeteoMm={openMeteoMm} tmdMm={tmd.rainMm} />;
}

export type TwoForecastsViewProps = {
  openMeteoMm: number;
  tmdMm: number;
};

export function TwoForecastsView({ openMeteoMm, tmdMm }: TwoForecastsViewProps) {
  const t = useTranslations("twoForecasts");
  const format = useFormatter();
  const verdict = agreement(openMeteoMm, tmdMm);
  const high = Math.max(openMeteoMm, tmdMm);

  return (
    <section className={card} data-two-forecasts={verdict}>
      <div className="flex flex-col gap-1">
        <h2 className="text-h3 font-bold text-jaga-ink">{t("title")}</h2>
        <p className={hint}>{t("body", { hours: HOURS })}</p>
      </div>

      <dl className="flex gap-4">
        {[
          { key: "openMeteo", mm: openMeteoMm },
          { key: "tmd", mm: tmdMm },
        ].map((model) => (
          <div
            key={model.key}
            className="flex flex-1 flex-col gap-1 rounded-xl border border-jaga-line bg-jaga-ground px-4 py-3"
            data-model={model.key}
          >
            <dt className={hint}>{t(`${model.key}.name`)}</dt>
            <dd className="text-[22px] font-bold tabular-nums text-jaga-ink">
              {format.number(model.mm)} <span className={`${hint} font-normal`}>{t("mm")}</span>
            </dd>
          </div>
        ))}
      </dl>

      {/*
       * What the two numbers together mean, in words. Never a colour: a reader must not be able to
       * read a level off this card, and disagreement between two models is not a level.
       */}
      <p className={verdict === "agree" ? hint : notice} data-verdict={verdict}>
        {verdict === "agree"
          ? t("agree")
          : t(verdict === "farApart" ? "farApart" : "differ", { mm: format.number(high) })}
      </p>

      <p className={hint}>{t("source")}</p>
    </section>
  );
}
