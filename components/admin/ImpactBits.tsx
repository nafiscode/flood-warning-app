"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { CheckIcon, TrophyIcon } from "@/components/icons";
import {
  areaPath,
  barPercent,
  chartPoints,
  cumulativeWaits,
  dotGrid,
  linePath,
  percent,
  type Outcome,
  type OutcomeCount,
  type WaitCount,
} from "@/lib/impact";
import motion from "./Impact.module.css";

/**
 * The parts the impact dashboard is drawn from. Five rules hold in all of them:
 *
 *  - **Colour never says which thing a mark is.** Jaga has one brand hue; the palette validator
 *    puts its teal and its neutral at ΔE 8.6 by day and 6.8 by night (the floor is 15), and any
 *    two steps of the teal at about 10. So identity is carried by *form* - a filled mark against
 *    a hollow one, a wash against a dashed line, a circle against a square - and by the words
 *    beside it. Length, angle and height carry the magnitude.
 *  - **The alert palette is never used.** Those colours mean an alert level (docs/brand.md), and
 *    a count is not a status - not even the count of requests nobody answered. The cup is teal
 *    for the same reason: gold would be the Watch yellow.
 *  - **Both themes come free**, because every colour is a brand token.
 *  - **Every chart has its numbers in words too**: the drawings are `aria-hidden` beside figures
 *    that are already readable, and each carries a table.
 *  - **The resting state is the finished chart** (Impact.module.css): the movement is an
 *    entrance, played once when the chart is first seen, and never under reduced motion.
 */

const TRACK = "h-2 w-full overflow-hidden rounded-full bg-jaga-ground";
const FILL = `h-full rounded-full bg-jaga-teal-ink ${motion.grow}`;

/**
 * A section whose charts play their entrance when it first scrolls into view. Before that, and
 * wherever there is no IntersectionObserver, the charts are simply drawn.
 */
export function Reveal({ className, children }: { className?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const seen = motion.seen ?? "";
    const watcher = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        if (seen) node.classList.add(seen);
        watcher.disconnect();
      },
      { threshold: 0.2 },
    );
    watcher.observe(node);
    return () => watcher.disconnect();
  }, []);
  return (
    <section ref={ref} className={className}>
      {children}
    </section>
  );
}

/**
 * A figure that counts up to its value once. The true figure is always in the page for a screen
 * reader, a test and a browser without scripts; the counting copy is decoration.
 */
export function CountUp({ value, format }: { value: number; format: (n: number) => string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof window.matchMedia !== "function") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const started = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / 1400);
      node.textContent = format(Math.round(value * (1 - Math.pow(1 - t, 3))));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      node.textContent = format(value);
    };
  }, [value, format]);
  return (
    <>
      <span className="sr-only">{format(value)}</span>
      <span ref={ref} aria-hidden="true">
        {format(value)}
      </span>
    </>
  );
}

/**
 * A share drawn as an arc of a ring, with the figure in the middle. `onDark` is for the navy
 * panel at the top, where the brand's light teal is the one that reads.
 */
export function Ring({
  share,
  size = 96,
  onDark = false,
  children,
}: {
  /** 0 to 100. */
  share: number;
  size?: number;
  onDark?: boolean;
  children: React.ReactNode;
}) {
  const lit = Math.min(100, Math.max(0, share));
  return (
    <div
      className="relative grid shrink-0 place-items-center"
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 100 100" className="absolute inset-0 size-full -rotate-90" aria-hidden>
        {onDark && (
          <circle
            cx="50"
            cy="50"
            r="48"
            fill="none"
            strokeWidth="2"
            strokeDasharray="0.6 3.4"
            className={`stroke-white/40 ${motion.ticks}`}
          />
        )}
        <circle
          cx="50"
          cy="50"
          r="40"
          fill="none"
          strokeWidth="7"
          className={onDark ? "stroke-white/15" : "stroke-jaga-ground"}
        />
        {lit > 0 && (
          <circle
            cx="50"
            cy="50"
            r="40"
            fill="none"
            strokeWidth="7"
            strokeLinecap="round"
            pathLength={100}
            strokeDasharray={`${lit} 100`}
            style={{ "--len": lit } as React.CSSProperties}
            className={`${motion.sweep} ${
              onDark ? `stroke-jaga-teal-light ${motion.glow}` : "stroke-jaga-teal-ink"
            }`}
          />
        )}
      </svg>
      <div className="relative flex flex-col items-center leading-tight">{children}</div>
    </div>
  );
}

/** A headline figure on the navy panel: the number is the whole mark. */
export function PanelStat({
  value,
  format,
  label,
  note,
  step,
}: {
  value: number;
  format: (n: number) => string;
  label: string;
  note?: string;
  step: number;
}) {
  return (
    <div
      className={`flex flex-col gap-1 border-s-2 border-jaga-teal-light/60 ps-3 ${motion.rise}`}
      style={{ "--i": step } as React.CSSProperties}
    >
      <span className="text-h2 font-bold tabular-nums text-white">
        <CountUp value={value} format={format} />
      </span>
      <span className="font-medium text-white">{label}</span>
      {note ? <span className="text-small text-white/75">{note}</span> : null}
    </div>
  );
}

/** How one outcome's mark is drawn. Four forms, so no reader needs the colour to tell them. */
const DOT: Record<Outcome, string> = {
  confirmed: "rounded-full bg-jaga-teal-ink",
  unconfirmed: "rounded-full border-2 border-jaga-teal-ink",
  cancelled: "scale-50 rounded-full bg-jaga-text-2",
  noTeam: "rounded-[2px] border-2 border-jaga-text-2",
};

function OutcomeMark({ outcome }: { outcome: Outcome }) {
  return <span className={`inline-block size-3 shrink-0 ${DOT[outcome]}`} aria-hidden="true" />;
}

/**
 * Every request as one mark, outcome after outcome: a request nobody accepted takes exactly the
 * room of one that ended in a rescue. The legend under it is the readable half - label, figure
 * and note for each outcome, all in the same size type.
 */
export function OutcomeDots({
  outcomes,
  total,
  label,
  note,
  cases,
}: {
  outcomes: OutcomeCount[];
  total: number;
  label: (outcome: Outcome) => string;
  note: (outcome: Outcome) => string;
  cases: (count: number, percent: number) => string;
}) {
  const t = useTranslations("impact");
  const grid = dotGrid(outcomes);
  let index = 0;
  return (
    <figure className="m-0 flex flex-col gap-4">
      <div
        className="grid grid-cols-[repeat(auto-fill,0.75rem)] gap-1"
        aria-hidden="true"
        data-outcome-dots
      >
        {grid.groups.flatMap((group) =>
          Array.from({ length: group.dots }, (_, i) => (
            <span
              key={`${group.outcome}-${i}`}
              className={`size-3 ${motion.pop}`}
              style={{ "--i": index++ } as React.CSSProperties}
            >
              <span className={`block size-full ${DOT[group.outcome]}`} />
            </span>
          )),
        )}
      </div>
      <p className="text-small text-jaga-text-2">
        {grid.unit === 1 ? t("outcomes.dotOne") : t("outcomes.dotMany", { count: grid.unit })}
      </p>
      <figcaption className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {grid.groups.map((group) => {
          const count = outcomes.find((o) => o.outcome === group.outcome)?.cases ?? 0;
          return (
            <div key={group.outcome} className="flex gap-3">
              <span className="mt-2">
                <OutcomeMark outcome={group.outcome} />
              </span>
              <div className="flex flex-col">
                <span className="font-medium">{label(group.outcome)}</span>
                <span className="tabular-nums text-jaga-text-2">
                  {cases(count, percent(count, total))}
                </span>
                <span className="text-small text-jaga-text-2">{note(group.outcome)}</span>
              </div>
            </div>
          );
        })}
      </figcaption>
    </figure>
  );
}

/**
 * Waiting, as a curve: of the requests a team accepted, how many had their team by each time.
 * Five points, so each is labelled; the bands are steps of a scale, not equal lengths of time,
 * which is why the points are evenly spaced and named rather than placed on a clock.
 */
export function WaitCurve({
  waits,
  by,
  band,
}: {
  waits: WaitCount[];
  by: (band: WaitCount["band"]) => string;
  band: (band: WaitCount["band"]) => string;
}) {
  const t = useTranslations("impact");
  const steps = cumulativeWaits(waits);
  const points = chartPoints(
    steps.map((s) => s.share),
    100,
  );
  return (
    <figure className="m-0 flex flex-col gap-3">
      <div className="relative mt-8 h-40" aria-hidden="true">
        <span className="absolute inset-x-0 top-0 border-t border-dashed border-jaga-line" />
        <span className="absolute inset-x-0 top-1/2 border-t border-dashed border-jaga-line" />
        <span className="absolute inset-x-0 bottom-0 border-t border-jaga-text-2" />
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="absolute inset-0 size-full overflow-visible"
        >
          <path d={areaPath(points)} className={`fill-jaga-teal-ink/15 ${motion.wipe}`} />
          <path
            d={linePath(points)}
            fill="none"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            className={`stroke-jaga-teal-ink ${motion.wipe}`}
          />
        </svg>
        {steps.map((step, i) => (
          <span
            key={step.band}
            className={`absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center ${motion.rise}`}
            style={
              {
                left: `${points[i]!.x}%`,
                top: `${points[i]!.y}%`,
                "--i": i + 4,
              } as React.CSSProperties
            }
            title={t("waits.tip", { by: by(step.band), percent: step.share })}
          >
            <span className="absolute bottom-3 text-small font-bold tabular-nums text-jaga-ink">
              {step.share}%
            </span>
            <span className="size-3 rounded-full bg-jaga-teal-ink ring-2 ring-jaga-surface" />
          </span>
        ))}
      </div>
      <div
        className="grid text-center text-small text-jaga-text-2"
        style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}
        aria-hidden="true"
      >
        {steps.map((step) => (
          <span key={step.band}>{by(step.band)}</span>
        ))}
      </div>
      <figcaption className="text-small text-jaga-text-2">{t("waits.curveNote")}</figcaption>
      <Numbers
        caption={t("waits.tableCaption")}
        head={[t("waits.band"), t("waits.cases"), t("waits.cumulative")]}
        rows={steps.map((s) => [band(s.band), String(s.cases), `${s.share}%`])}
      />
    </figure>
  );
}

/**
 * Requests per week as a wave. Two series on one axis from zero, told apart by form and not by
 * colour: the cases a team confirmed are the filled area, all the requests of the week are the
 * dashed line above it. Pointing at a week shows its figures; the table has them all.
 */
export function WeekWave({
  weeks,
  weekLabel,
}: {
  weeks: { from: string; requests: number; confirmed: number }[];
  weekLabel: (from: string) => string;
}) {
  const t = useTranslations("impact");
  const max = weeks.reduce((a, w) => (w.requests > a ? w.requests : a), 0);
  const requests = chartPoints(
    weeks.map((w) => w.requests),
    max,
  );
  const confirmed = chartPoints(
    weeks.map((w) => w.confirmed),
    max,
  );
  const peak = weeks.reduce((best, w, i) => (w.requests > weeks[best]!.requests ? i : best), 0);
  return (
    <figure className="m-0 flex flex-col gap-3">
      <div className="relative mt-8 h-44">
        <span
          className="absolute inset-x-0 bottom-0 border-t border-jaga-text-2"
          aria-hidden="true"
        />
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="absolute inset-0 size-full overflow-visible"
          aria-hidden="true"
        >
          <path d={areaPath(confirmed)} className={`fill-jaga-teal-ink/25 ${motion.wipe}`} />
          <path
            d={linePath(confirmed)}
            fill="none"
            strokeWidth="2"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            className={`stroke-jaga-teal-ink ${motion.wipe}`}
          />
          <g className={motion.wipe}>
            <path
              d={linePath(requests)}
              fill="none"
              strokeWidth="2"
              strokeLinejoin="round"
              strokeDasharray="5 4"
              vectorEffect="non-scaling-stroke"
              className="stroke-jaga-ink"
            />
          </g>
        </svg>
        {weeks.length > 0 && (
          <span
            className={`absolute -translate-x-1/2 whitespace-nowrap text-small font-bold tabular-nums text-jaga-ink ${motion.rise}`}
            style={
              {
                left: `${Math.min(80, Math.max(20, requests[peak]!.x))}%`,
                top: "-1.75rem",
                "--i": 12,
              } as React.CSSProperties
            }
            aria-hidden="true"
          >
            {t("season.peak", { count: weeks[peak]!.requests })}
          </span>
        )}
        <ul className="absolute inset-0 m-0 flex list-none p-0" aria-hidden="true">
          {weeks.map((week, i) => (
            <li key={week.from} className="group relative h-full flex-1" data-week>
              <span className="absolute inset-y-0 left-1/2 hidden w-px bg-jaga-text-2 group-hover:block" />
              <span
                className="absolute left-1/2 hidden size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-jaga-teal-ink ring-2 ring-jaga-surface group-hover:block"
                style={{ top: `${confirmed[i]!.y}%` }}
              />
              <span
                className={`pointer-events-none absolute top-0 z-10 hidden w-max max-w-48 rounded-lg border border-jaga-line bg-jaga-surface px-3 py-2 text-small shadow-md group-hover:block ${
                  i < weeks.length / 2 ? "start-1/2 ms-2" : "end-1/2 me-2"
                }`}
              >
                {t("season.weekTip", {
                  week: weekLabel(week.from),
                  requests: week.requests,
                  confirmed: week.confirmed,
                })}
              </span>
            </li>
          ))}
        </ul>
      </div>
      {weeks.length > 1 && (
        <div className="flex justify-between text-small text-jaga-text-2" aria-hidden="true">
          <span>{weekLabel(weeks[0]!.from)}</span>
          <span>{weekLabel(weeks[weeks.length - 1]!.from)}</span>
        </div>
      )}
      <figcaption className="flex flex-wrap gap-x-5 gap-y-1 text-small text-jaga-text-2">
        <span className="inline-flex items-center gap-2">
          <span
            className="h-3 w-5 rounded-sm border-t-2 border-jaga-teal-ink bg-jaga-teal-ink/25"
            aria-hidden="true"
          />
          {t("season.legendConfirmed")}
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="w-5 border-t-2 border-dashed border-jaga-ink" aria-hidden="true" />
          {t("season.legendRest")}
        </span>
      </figcaption>
      <Numbers
        caption={t("season.tableCaption")}
        head={[t("season.week"), t("season.requests"), t("season.confirmed")]}
        rows={weeks.map((w) => [weekLabel(w.from), String(w.requests), String(w.confirmed)])}
      />
    </figure>
  );
}

/** The numbers behind a chart, for anyone who would rather read them (or cannot see the marks). */
export function Numbers({
  caption,
  head,
  rows,
}: {
  caption: string;
  head: string[];
  rows: string[][];
}) {
  return (
    <details className="rounded-xl border border-jaga-line bg-jaga-surface px-4">
      <summary className="flex min-h-tap cursor-pointer items-center font-medium">
        {caption}
      </summary>
      <div className="overflow-x-auto pb-4">
        <table className="w-full border-collapse text-small">
          <thead>
            <tr>
              {head.map((cell) => (
                <th key={cell} className="border-b border-jaga-line py-2 text-start font-medium">
                  {cell}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row[0]}>
                {row.map((cell, i) => (
                  <td
                    key={`${row[0]}-${i}`}
                    className={`border-b border-jaga-line py-2 ${i === 0 ? "" : "tabular-nums"}`}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/**
 * The cup: for the few teams the month's thanks go to, and nowhere else. One size, one colour,
 * one tilt when it is first seen. `first` gives the top of the list a tinted disc behind it.
 */
export function Cup({ first = false, size = 24 }: { first?: boolean; size?: number }) {
  return (
    <span
      className={`inline-grid shrink-0 place-items-center self-start rounded-full text-jaga-teal-ink ${
        first ? "bg-jaga-teal-ink/15 p-2" : ""
      }`}
      data-cup
    >
      <TrophyIcon size={size} className={motion.cup} />
    </span>
  );
}

/** A milestone a unit has reached. Teal with a tick: earned, and never a status colour. */
export function MilestoneChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-jaga-teal-ink px-3 py-1 text-small font-medium text-jaga-teal-ink">
      <CheckIcon size={16} />
      {children}
    </span>
  );
}

/** A plain fact about a unit: its province, what it can do. Neutral, never a status. */
export function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-jaga-line px-3 py-1 text-small text-jaga-text-2">
      {children}
    </span>
  );
}

/** How far a unit is from its next milestone: a track it can fill, and how many are missing. */
export function NextStepBar({
  words,
  current,
  target,
}: {
  words: string;
  current: number;
  target: number;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className={TRACK} aria-hidden="true">
        <div className={FILL} style={{ width: `${barPercent(current, target)}%` }} />
      </div>
      <span className="text-small font-medium text-jaga-teal-ink">{words}</span>
    </div>
  );
}

export const lift = motion.lift ?? "";
export const now = motion.now ?? "";
export const consolePanel = motion.console ?? "";
export const rise = motion.rise ?? "";
