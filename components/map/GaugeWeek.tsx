import { useFormatter, useTranslations } from "next-intl";
import { riverWeek, WEEK_H, WEEK_W, type Week } from "@/lib/gauge-week";
import type { Gauge } from "@/lib/map-data";
import { hint } from "@/lib/ui";

/**
 * The week a river has had, as a line: the eight daily lows the card's "rose on N of the last 7
 * days" was counted from (the owner, 22 Nov 2026 - "instead of just word we should have a minimal
 * graph to support the wording as well, trend graphs").
 *
 * It is deliberately the smallest chart that can carry the sentence above it. How it is drawn, and
 * why - the geometry and the scale's floor are in lib/gauge-week.ts:
 *
 *   * **The words come first and stand alone.** The sentence is already on the card and is not
 *     moved or shortened: the thing the owner wants a reader to see - "it has been going up all
 *     week" - must not start depending on reading a picture. The line supports the sentence; it
 *     does not replace it.
 *   * **Every one of the eight figures is in the label**, in day order, so nothing this chart says
 *     is gated behind seeing it. That is also why there is no tooltip layer beyond the browser's
 *     own `<title>`: this is read on a phone, where nothing hovers, and giving eight dots their
 *     own tab stops would put a chart between someone tabbing and the hotlines (the dam's charts
 *     settled this in components/map/DamHistory.tsx).
 *   * **One hue, and never the alert palette.** The line is the river's own blue at every height,
 *     because a reading is a measurement and not an alert (docs/brand.md, safety rule 2). The one
 *     thing drawn differently is yesterday's dot, filled, because "where it has got to" is the
 *     point a reader looks for first.
 *   * **No threshold line across it.** A *daily low* below Watch says nothing about whether that
 *     day's peak was. The levels belong on the cross-section, which is drawn from the reading they
 *     grade; here they would be a claim the series cannot support (safety rule 8).
 *   * **Nothing moves.** A line that drew itself in would be a week that looked like it was still
 *     happening. The series ends yesterday and sits still.
 */

/** The dot a reader looks for: yesterday, where the river has got to. */
function Dots({ week }: { week: Week }) {
  const last = week.points.length - 1;
  return (
    <>
      {week.points.map((p) => (
        <circle
          key={p.index}
          cx={p.x}
          cy={p.y}
          r={p.index === last ? 4 : 2.6}
          fill={p.index === last ? "var(--jaga-dam)" : "var(--jaga-surface)"}
          stroke="var(--jaga-dam)"
          strokeWidth="1.6"
          data-week-point={p.index}
        />
      ))}
    </>
  );
}

export function GaugeWeek({ gauge }: { gauge: Gauge }) {
  const t = useTranslations("map.gauge.week");
  const format = useFormatter();
  const week = riverWeek(gauge.weekFloors);
  if (!week) return null;

  const m = (value: number) => format.number(value, { minimumFractionDigits: 2 });
  // Oldest first, the way the line runs. The label is the chart in words.
  const figures = week.points.map((p) => m(p.metres)).join(", ");

  return (
    <div className="flex flex-col gap-1" data-gauge-week-chart={gauge.id}>
      <svg
        viewBox={`0 0 ${WEEK_W} ${WEEK_H}`}
        className="h-auto w-full max-w-[22rem]"
        role="img"
        aria-label={t("chart", { figures, low: m(week.low), high: m(week.high) })}
      >
        <title>{t("chartTitle")}</title>
        {/*
         * A hairline at the top and bottom of the scale, and nothing else: enough to see that the
         * line is inside a range, without drawing a grid that would invite reading values off it.
         * The figures for those two edges are printed under the chart.
         */}
        <path
          d={`M0 8 L ${WEEK_W} 8`}
          stroke="var(--jaga-line)"
          strokeWidth="1"
          fill="none"
          aria-hidden="true"
        />
        <path
          d={`M0 ${WEEK_H - 8} L ${WEEK_W} ${WEEK_H - 8}`}
          stroke="var(--jaga-line)"
          strokeWidth="1"
          fill="none"
          aria-hidden="true"
        />
        <path
          d={week.path}
          stroke="var(--jaga-dam)"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        <Dots week={week} />
      </svg>
      {/*
       * What the top and bottom of the box are worth, and which end is which day. Without these
       * the line has a shape but no size, and a reader cannot tell 2 cm from 2 m.
       */}
      <p className={hint}>
        {t("scale", { low: m(week.bottom), high: m(week.top) })} · {t("axis")}
      </p>
    </div>
  );
}
