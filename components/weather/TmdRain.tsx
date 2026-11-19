"use client";

import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { DropIcon } from "@/components/icons";
import { nearestStations, stationName, type TmdStation } from "@/lib/tmd-stations";
import { useNow } from "@/lib/use-public";
import { card, hint } from "@/lib/ui";
import type { WeatherPlace } from "@/lib/weather";

/**
 * Rain actually measured, beside the forecast (owner, 18 Nov 2026): the 24-hour total at TMD's
 * nearest stations, each with its distance and the hour it was read.
 *
 * Everything else on this page is a model's view of the future. This is the one block that is a
 * measurement, and it is careful about what it does not know: it reports a named station tens of
 * kilometres away, never "rain near you", because rain here is local enough that the difference
 * matters (safety rule 8). It carries no level and no alert colour (safety rule 10).
 */
export function TmdRain({
  place,
  className,
}: {
  place: WeatherPlace | null;
  /** The width the page wants this card at, worn by the card so an undrawn card takes none. */
  className?: string;
}) {
  const [stations, setStations] = useState<TmdStation[] | null>(null);
  const now = useNow();

  useEffect(() => {
    let live = true;
    // Asked for once the page is up: it is a nice-to-have beside the forecast, and must never
    // compete with it. A failure leaves the card undrawn, which is the quiet, correct outcome.
    fetch("/api/public/tmd/stations", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status));
        return response.json() as Promise<{ stations: TmdStation[] }>;
      })
      .then((body) => {
        if (live) setStations(body.stations ?? []);
      })
      .catch(() => {
        if (live) setStations([]);
      });
    return () => {
      live = false;
    };
  }, []);

  // The clock comes from useNow(), not Date.now(): the staleness test has to be a value React can
  // re-render on, so a station that goes quiet drops off by itself without a reload. It is 0 until
  // the phone's clock is readable, and nothing is drawn until then - which is also true while the
  // readings are still being fetched.
  if (!stations || now === 0) return null;
  const nearest = nearestStations(stations, place, now);
  if (nearest.length === 0) return null;
  return <TmdRainView stations={nearest} hasPlace={place !== null} className={className} />;
}

export type TmdRainViewProps = {
  /** Already narrowed and sorted by the caller, so a test can fix the list. */
  stations: TmdStation[];
  hasPlace: boolean;
  className?: string;
};

export function TmdRainView({ stations, hasPlace, className }: TmdRainViewProps) {
  const t = useTranslations("tmdRain");
  const locale = useLocale();
  const format = useFormatter();
  if (stations.length === 0) return null;

  return (
    <section
      className={className ? `${card} ${className}` : card}
      data-tmd-rain={String(stations.length)}
    >
      <div className="flex items-start gap-3">
        <DropIcon size={24} className="mt-0.5 shrink-0 text-jaga-slate" aria-hidden="true" />
        <div className="flex flex-col gap-1">
          <h2 className="text-h3 font-bold text-jaga-ink">{t("title")}</h2>
          {/* The honest framing: this is a station's reading, not the reader's village. */}
          <p className={hint}>{hasPlace ? t("body") : t("bodyNoPlace")}</p>
        </div>
      </div>

      <ul className="flex flex-col gap-3">
        {stations.map((station) => (
          <li
            key={station.id}
            className="flex items-baseline justify-between gap-3 border-b border-jaga-line pb-3 last:border-0 last:pb-0"
            data-tmd-station={station.id}
          >
            <div className="flex flex-col">
              <span className="font-medium text-jaga-ink">{stationName(station, locale)}</span>
              <span className={hint}>
                {station.distanceKm === undefined
                  ? station.provinceTh
                  : t("away", { km: Math.round(station.distanceKm) })}
                {station.observedAt &&
                  ` · ${t("at", {
                    time: format.dateTime(new Date(station.observedAt), {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                      hourCycle: "h23",
                      timeZone: "Asia/Bangkok",
                    }),
                  })}`}
              </span>
            </div>
            {/* The figure, and its unit, in words a reader can repeat on the phone. */}
            <span className="shrink-0 text-right tabular-nums" data-tmd-rain-mm="true">
              <span className="text-[22px] font-bold text-jaga-ink">
                {station.rain24hMm === null ? "–" : format.number(station.rain24hMm)}
              </span>{" "}
              <span className={hint}>{t("mm")}</span>
            </span>
          </li>
        ))}
      </ul>

      <p className={hint}>{t("source")}</p>
    </section>
  );
}
