"use client";

import { useFormatter, useTranslations } from "next-intl";
import { flow, volume, type Dam } from "@/lib/dam";
import {
  bars,
  hadSpill,
  levelY,
  run,
  scaleFor,
  storageLine,
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

/**
 * The reservoir behind the releases: how full it was at the end of each day.
 *
 * A line and not bars, because storage is a level and not a quantity that starts at nothing each
 * day - and the axis runs from empty to the dam's full capacity, so an ordinary fortnight (743.9
 * to 748.3 million m3) reads as flat rather than as the mountain range a zoomed axis would draw.
 * The capacity at normal high water is a marked line, since that is the figure an operator works
 * to; the gates open when the water climbs towards it.
 */
function Storage({ days, dam }: { days: readonly DamDay[]; dam: Dam }) {
  const t = useTranslations("dam");
  const format = useFormatter();
  const capacity = dam.storageMaxMcm ?? 0;
  if (!(capacity > 0)) return null;
  const runs = storageLine(days, capacity);
  const points = runs.flat();
  if (points.length < 2) return null;
  const last = points[points.length - 1]!;
  const normalY = levelY(dam.storageNormalMcm, capacity);
  const n = (value: number, digits = 0) => format.number(value, { maximumFractionDigits: digits });
  const ticks = [days[0], days[Math.floor((days.length - 1) / 2)], days[days.length - 1]];

  return (
    <div className="flex flex-col gap-1" data-dam-chart="storage">
      <p className="font-medium">{t("history.storageTitle")}</p>
      <div
        role="img"
        aria-label={t("history.storageChart", {
          days: days.length,
          mcm: n(last.value),
          percent: n(last.percent, 1),
        })}
        className="relative h-28 w-full max-w-[26rem] border-b border-jaga-line"
      >
        <svg
          className="absolute inset-0 h-full w-full"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {normalY !== null && (
            <line
              x1="0"
              x2="100"
              y1={normalY}
              y2={normalY}
              /* The ink, not the grid colour: a threshold a reader must see, not a gridline. */
              className="stroke-jaga-text-2"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          )}
          {runs.map((part) => (
            <g key={part[0]!.day}>
              {/* The water under the line: a wash, never a block (10%). */}
              <polygon
                className="fill-jaga-dam"
                opacity="0.1"
                points={`${part[0]!.x},100 ${part.map((p) => `${p.x},${p.y}`).join(" ")} ${part[part.length - 1]!.x},100`}
              />
              <polyline
                className="stroke-jaga-dam"
                fill="none"
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
                points={part.map((p) => `${p.x},${p.y}`).join(" ")}
              />
            </g>
          ))}
        </svg>
        {/* The end dot and its label are HTML, so the dot stays round whatever the box's shape. */}
        <span
          aria-hidden="true"
          className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-jaga-dam ring-2 ring-jaga-surface"
          style={{ left: `${last.x}%`, top: `${last.y}%` }}
        />
        {/*
         * Above the line, or below it when the reservoir is nearly full: at 93% the label would
         * otherwise sit outside the box and over the heading (seen in a browser).
         */}
        <span
          className={`absolute end-0 whitespace-nowrap text-small tabular-nums text-jaga-text-2 ${
            last.y < 25 ? "pt-2" : "-translate-y-full pb-2"
          }`}
          style={{ top: `${last.y}%` }}
        >
          {t("history.storageValue", { mcm: n(last.value), percent: n(last.percent, 1) })}
        </span>
      </div>
      <div className="flex w-full max-w-[26rem] justify-between gap-2 text-small text-jaga-text-2">
        {ticks.map((tick, place) => (
          <span key={`${tick?.day}-${place}`} className="tabular-nums">
            {tick ? label(tick.day, format) : ""}
          </span>
        ))}
      </div>
      {normalY !== null && (
        <p className={hint}>{t("history.normalLine", { mcm: n(dam.storageNormalMcm ?? 0) })}</p>
      )}
      <p className={hint}>{t("history.storageScale", { mcm: n(capacity) })}</p>
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
              {t("history.columns.storage")}
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
              <td className="py-1 text-end tabular-nums">
                {day.storageEndMcm === null ? "—" : n(Math.round(day.storageEndMcm))}
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
      {/* The reservoir behind those releases: the cause after the effect. */}
      <Storage days={days} dam={dam} />
      <Numbers days={days} />
      <p className={hint}>{t("history.note")}</p>
    </div>
  );
}
