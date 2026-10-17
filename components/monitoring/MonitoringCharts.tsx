import { useFormatter, useTranslations } from "next-intl";
import { GAUGE_LOOKS, gaugeLook, type GaugeLook } from "@/lib/gauge-marks";
import type { GaugeReading } from "@/lib/map-data";
import type { Weather } from "@/lib/weather";
import { DRY_MM } from "@/lib/weather";
import { hint } from "@/lib/ui";

/**
 * The charts in the opened monitoring section (the owner, 17 Oct 2026: "it could be graph or
 * charts if you can add them").
 *
 * Drawn the way the dam's fortnight already is (components/map/DamHistory.tsx), and for the same
 * reasons: **one hue, with length carrying the magnitude**, because Jaga has a single teal whose
 * steps sit too close to tell two series apart by colour, and the alert palette is kept for
 * levels a person issued (docs/brand.md). Every chart is also a sentence for a screen reader,
 * and every chart says which window it covers and when its figures were taken, because a chart
 * without its clock invites a reader to treat it as now (safety rules 3 and 8).
 *
 * Everything here is drawn from answers the page already holds. Nothing is fetched, and no
 * river's level over time is drawn at all: the public gauge feed carries the latest reading, its
 * bank and a three-hour change, and no history - so a level-over-time line would have to be
 * invented, and it is not (the owner was told; 17 Oct).
 */

/** The bars' own colour: the map's water, as the dam's charts use. */
const WATER = "bg-jaga-dam";

function Figure({
  title,
  label,
  footnote,
  children,
}: {
  title: string;
  label: string;
  footnote?: string;
  children: React.ReactNode;
}) {
  return (
    <figure className="m-0 flex flex-col gap-1" data-monitoring-chart="true">
      <figcaption className="font-medium">{title}</figcaption>
      <div
        role="img"
        aria-label={label}
        className="relative flex h-24 w-full items-end gap-[2px] border-b border-jaga-line pt-5"
      >
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-1/2 border-t border-jaga-line"
        />
        {children}
      </div>
      {footnote && <p className={hint}>{footnote}</p>}
    </figure>
  );
}

/**
 * Where the rivers stand, as a count per state. It is a distribution and not a history: this is
 * what the feed can answer, and the chart says so rather than drawing a line it cannot know.
 */
export function GaugeSpread({ gauges, scope }: { gauges: readonly GaugeReading[]; scope: string }) {
  const t = useTranslations("monitoring.charts");
  // Worst first, left to right, and the silent ones last: they are counted, never drawn as low.
  const order: GaugeLook[] = ["over", "near", "normal", "nolevels", "quiet"];
  const counts = order.map((look) => ({
    look,
    count: gauges.filter((g) => gaugeLook(g.status) === look).length,
  }));
  const top = Math.max(1, ...counts.map((c) => c.count));
  const said = counts
    .filter((c) => c.count > 0)
    .map((c) => `${t(`gauges.${c.look}`)} ${c.count}`)
    .join(", ");

  return (
    <Figure
      title={t("gauges.title", { scope })}
      label={t("gauges.said", { said: said || t("gauges.none"), total: gauges.length })}
      footnote={t("gauges.note")}
    >
      {counts.map(({ look, count }) => (
        <span key={look} className="relative flex h-full flex-1 flex-col justify-end gap-1">
          <span
            className={`w-full rounded-t ${WATER} ${look === "quiet" ? "opacity-40" : ""}`}
            style={{ height: `${(count / top) * 100}%` }}
          />
          <span className="text-small tabular-nums text-jaga-text-2">{count}</span>
        </span>
      ))}
    </Figure>
  );
}

/** How much rain the model has, hour by hour, for as far ahead as it speaks. */
export function RainAhead({ weather, place }: { weather: Weather; place: string }) {
  const t = useTranslations("monitoring.charts");
  const format = useFormatter();
  const time = (iso: string) =>
    format.dateTime(new Date(iso), {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Bangkok",
    });
  const now = Date.parse(weather.at);
  const hours = weather.hours.filter((h) => Date.parse(h.at) >= now - 3_600_000).slice(0, 24);
  if (hours.length === 0) return null;
  const top = Math.max(DRY_MM * 10, ...hours.map((h) => h.rainMm));
  const total = hours.reduce((sum, h) => sum + h.rainMm, 0);
  const ticks = [hours[0], hours[Math.floor((hours.length - 1) / 2)], hours[hours.length - 1]];

  return (
    <div className="flex flex-col gap-1">
      <Figure
        title={t("rain.title", { hours: hours.length, place })}
        label={t("rain.said", {
          hours: hours.length,
          total: total.toFixed(1),
          top: top.toFixed(1),
        })}
      >
        {hours.map((h) => (
          <span key={h.at} className="relative flex h-full flex-1 items-end">
            <span
              title={`${time(h.at)} · ${h.rainMm.toFixed(1)} mm`}
              className={`w-full rounded-t ${WATER} ${h.rainMm < DRY_MM ? "opacity-25" : ""}`}
              style={{
                height: `${Math.max(h.rainMm / top, h.rainMm < DRY_MM ? 0.02 : 0.04) * 100}%`,
              }}
            />
          </span>
        ))}
      </Figure>
      <div className="flex justify-between gap-2 text-small tabular-nums text-jaga-text-2">
        {ticks.map((tick, place2) => (
          <span key={`${tick?.at}-${place2}`}>{tick ? time(tick.at) : ""}</span>
        ))}
      </div>
      <p className={hint}>{t("rain.note", { total: total.toFixed(1) })}</p>
    </div>
  );
}
