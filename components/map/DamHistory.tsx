"use client";

import { useFormatter, useTranslations } from "next-intl";
import { flow, volume, type Dam } from "@/lib/dam";
import {
  bars,
  hadSpill,
  run,
  scaleFor,
  type DamBar,
  type DamDay,
  type DamMeasure,
} from "@/lib/dam-chart";
import { hint } from "@/lib/ui";

/**
 * The dam's fortnight as two charts (the owner, 12 Oct: "charts as well to show the trends of the
 * water flow out from spillway, people can see if it's continuously increased for few days or a
 * week, this also give people awareness").
 *
 * How it is drawn, and why:
 *
 *   * **Two charts, one scale, one hue.** The release and the spill are never two colours on one
 *     chart: two steps of Jaga's single teal sit about 10 apart for normal colour vision, under
 *     the floor of 15 that telling series apart by colour needs, and the alert palette is
 *     reserved for levels a person issued (docs/brand.md). Both charts are the river's own blue
 *     from the map, they share the scale so their heights can be compared, and the words above
 *     each one carry the identity.
 *   * **The trend is also said in a sentence**, because the thing the owner wants people to see -
 *     "it has gone up every day this week" - should not depend on reading a picture.
 *   * **A short day is drawn fainter and counted apart.** The feed publishes late and with gaps,
 *     so a day with a few hours in it must not read as a day when the dam released little.
 *   * **Every number is in the table below**, so nothing on this card is gated behind seeing.
 *     That table is also why there is no tooltip layer beyond the browser's own: this is read on
 *     a phone, where there is no hover at all, and giving twenty-eight bars their own tab stop
 *     would put the whole chart in the way of someone tabbing to the hotlines.
 */

function label(day: string, format: ReturnType<typeof useFormatter>) {
  // The day is a Bangkok calendar date. Read as UTC so no browser's own zone can shift it.
  return format.dateTime(new Date(`${day}T00:00:00Z`), {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

function Chart({
  title,
  rows,
  scale,
  measure,
}: {
  title: string;
  rows: DamBar[];
  scale: number;
  measure: DamMeasure;
}) {
  const t = useTranslations("dam");
  const format = useFormatter();
  const n = (value: number) => format.number(value, { maximumFractionDigits: 0 });
  const top = rows.reduce((best, r) => Math.max(best, r.value ?? 0), 0);
  const back = [...rows].reverse();
  // The label goes on the last whole day: a part-published day's figure would disagree with the
  // sentence above the chart, which counts whole days only.
  const latest =
    back.find((r) => r.value !== null && r.whole) ?? back.find((r) => r.value !== null) ?? null;
  const ticks = [rows[0], rows[Math.floor((rows.length - 1) / 2)], rows[rows.length - 1]];

  return (
    <div className="flex flex-col gap-1" data-dam-chart={measure}>
      <p className="font-medium">{title}</p>
      <div
        role="img"
        aria-label={t("history.chart", {
          title,
          days: rows.length,
          top: n(top),
          latest: latest && latest.value !== null ? n(latest.value) : "—",
        })}
        /* A hairline baseline and one hairline at half the scale: enough to read heights by. */
        className="relative flex h-28 w-full max-w-[26rem] items-end gap-[2px] border-b border-jaga-line pt-5"
      >
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-1/2 border-t border-jaga-line"
        />
        {rows.map((bar) => (
          <span key={bar.day} className="relative flex h-full max-w-6 flex-1 items-end">
            {bar.value !== null && (
              <span
                title={`${label(bar.day, format)} · ${t("history.value", {
                  cms: flow(bar.value) ?? 0,
                  hours: bar.hours,
                })}`}
                className={`w-full rounded-t bg-jaga-dam ${bar.whole ? "" : "opacity-50"}`}
                style={{ height: `${bar.percent}%` }}
              />
            )}
            {/* One direct label, on the last whole day: never a number on every bar. */}
            {latest?.value != null && latest.day === bar.day && (
              <span
                className="absolute right-0 whitespace-nowrap text-small tabular-nums text-jaga-text-2"
                style={{ bottom: `calc(${bar.percent}% + 2px)` }}
              >
                {n(latest.value)}
              </span>
            )}
          </span>
        ))}
      </div>
      <div className="flex w-full max-w-[26rem] justify-between gap-2 text-small text-jaga-text-2">
        {ticks.map((tick, place) => (
          <span key={`${tick?.day}-${place}`} className="tabular-nums">
            {tick ? label(tick.day, format) : ""}
          </span>
        ))}
      </div>
      <p className={hint}>{t("history.scale", { cms: n(scale) })}</p>
    </div>
  );
}

function Numbers({ days }: { days: readonly DamDay[] }) {
  const t = useTranslations("dam");
  const format = useFormatter();
  const n = (value: number | null, digits = 0) =>
    value === null ? "—" : format.number(value, { maximumFractionDigits: digits });
  return (
    <details className="text-small">
      <summary className="min-h-tap cursor-pointer py-2 underline">{t("history.numbers")}</summary>
      <table className="w-full border-collapse text-start">
        <thead>
          <tr className="text-jaga-text-2">
            <th scope="col" className="py-1 text-start font-medium">
              {t("history.columns.day")}
            </th>
            <th scope="col" className="py-1 text-end font-medium">
              {t("history.columns.outflow")}
            </th>
            <th scope="col" className="py-1 text-end font-medium">
              {t("history.columns.spill")}
            </th>
            <th scope="col" className="py-1 text-end font-medium">
              {t("history.columns.hours")}
            </th>
          </tr>
        </thead>
        <tbody>
          {[...days].reverse().map((day) => (
            <tr key={day.day} className="border-t border-jaga-line">
              <th scope="row" className="py-1 text-start font-normal">
                {label(day.day, format)}
              </th>
              <td className="py-1 text-end tabular-nums">
                {day.hours > 0 ? n(flow(day.outflowMeanCms)) : t("history.noData")}
              </td>
              <td className="py-1 text-end tabular-nums">
                {day.hours > 0 ? n(volume(day.spilledMcm), 2) : "—"}
              </td>
              <td className="py-1 text-end tabular-nums">{day.hours}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className={hint}>{t("history.columnsNote")}</p>
    </details>
  );
}

export function DamHistory({ dam }: { dam: Dam }) {
  const t = useTranslations("dam");
  const format = useFormatter();
  const days = dam.days ?? [];
  // Two days is the least that can show a direction at all.
  if (days.length < 2) return null;
  const scale = scaleFor(days);
  const trend = run(days);
  const n = (value: number) => format.number(value, { maximumFractionDigits: 0 });

  return (
    <div className="flex flex-col gap-3" data-dam-history={String(days.length)}>
      <p className="font-medium">{t("history.title", { days: days.length })}</p>
      {trend && trend.direction !== "steady" && trend.days >= 2 && (
        <p>
          {t(`history.trend.${trend.direction}`, {
            days: trend.days,
            from: n(trend.from),
            to: n(trend.to),
          })}
        </p>
      )}
      <Chart
        title={t("history.outflowTitle")}
        rows={bars(days, "outflow", scale)}
        scale={scale}
        measure="outflow"
      />
      {hadSpill(days) ? (
        <Chart
          title={t("history.spillTitle")}
          rows={bars(days, "spill", scale)}
          scale={scale}
          measure="spill"
        />
      ) : (
        /* A chart of noughts says less than a sentence, and takes more of a small screen. */
        <p>{t("history.noSpill", { days: days.length })}</p>
      )}
      <Numbers days={days} />
      <p className={hint}>{t("history.note")}</p>
    </div>
  );
}
