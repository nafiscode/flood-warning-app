"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { areaPath, chartPoints, linePath } from "@/lib/impact";
import {
  heatStep,
  rhythmGrid,
  scaleMax,
  type DayPoint,
  type FunnelStep,
  type TimePoint,
  type UsageData,
} from "@/lib/usage";
import motion from "./Usage.module.css";

/**
 * The usage dashboard's charts. One hue throughout (the brand's teal ink): every chart carries a
 * single measure, so colour never has to say which series a mark belongs to, and the words do the
 * naming (the dataviz rule this project keeps since the impact dashboard: Jaga's teal steps are
 * too close together to tell series apart). Magnitude on the map and the week grid is the same
 * teal, light to dark, with its scale drawn beside it. Every chart has its table in a <details>.
 */

export const usageMotion = motion;

const BKK = "Asia/Bangkok";

/** A section that plays its entrance once, when it is first scrolled into view. */
export function Seen({ className, children }: { className?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const watcher = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        node.classList.add(motion.seen ?? "");
        watcher.disconnect();
      },
      { threshold: 0.15 },
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

export const shortDay = (iso: string, locale: string) =>
  new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" }).format(
    new Date(`${iso.slice(0, 10)}T00:00:00Z`),
  );

export const hourText = (iso: string, locale: string) =>
  new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: BKK,
  }).format(new Date(iso));

const dayHour = (iso: string, locale: string) =>
  new Intl.DateTimeFormat(locale, {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: BKK,
  }).format(new Date(iso));

/** A hover note over one column. Never the only way to the figure: the table holds them all. */
function Tip({ children, side }: { children: React.ReactNode; side: "start" | "end" }) {
  return (
    <span
      className={`pointer-events-none absolute bottom-full z-10 mb-1 hidden w-max max-w-52 rounded-lg border border-jaga-line bg-jaga-surface px-3 py-2 text-small text-jaga-text shadow-md group-hover:block ${
        side === "start" ? "start-0" : "end-0"
      }`}
    >
      {children}
    </span>
  );
}

/** Phones a day across the window, today last; an alert day carries a small mark above its bar. */
export function DayBars({
  series,
  alerts,
  locale,
  format,
}: {
  series: DayPoint[];
  alerts: UsageData["alerts"];
  locale: string;
  format: (n: number) => string;
}) {
  const t = useTranslations("usage.days");
  const max = scaleMax(series.map((d) => d.devices));
  const alertDays = new Set(
    alerts.map((a) => new Intl.DateTimeFormat("en-CA", { timeZone: BKK }).format(new Date(a.at))),
  );
  const last = series[series.length - 1];
  const ticks =
    series.length > 2 ? [0, Math.floor((series.length - 1) / 2), series.length - 1] : [0];
  return (
    <figure className="flex flex-col gap-2" data-usage-days>
      <div className="relative">
        <ol className="flex h-40 items-end gap-[2px] border-b border-jaga-line" aria-hidden="true">
          {series.map((d, i) => {
            const height = Math.max(d.devices > 0 ? 2 : 0, (d.devices / max) * 100);
            const marked = alertDays.has(d.day);
            return (
              <li key={d.day} className="group relative flex h-full flex-1 flex-col justify-end">
                {marked && (
                  <span className="mb-1 self-center text-[10px] leading-none text-jaga-ink">▲</span>
                )}
                <span
                  className={`block w-full max-w-6 self-center rounded-t-[4px] bg-jaga-teal-ink group-hover:bg-jaga-teal ${motion.bar}`}
                  style={{ height: `${height}%`, "--i": i } as React.CSSProperties}
                />
                <Tip side={i < series.length / 2 ? "start" : "end"}>
                  <span className="block font-bold">{shortDay(d.day, locale)}</span>
                  {t("tip", {
                    devices: format(d.devices),
                    fresh: format(d.newDevices),
                    sessions: format(d.sessions),
                  })}
                  {marked && <span className="block">{t("alertDay")}</span>}
                </Tip>
              </li>
            );
          })}
        </ol>
        {last && (
          <p className="absolute end-0 top-0 rounded bg-jaga-surface/90 px-1 text-small font-bold text-jaga-ink">
            {t("today", { devices: format(last.devices) })}
          </p>
        )}
      </div>
      <div className="flex justify-between text-small text-jaga-text-2">
        {ticks.map((i) => (
          <span key={i}>{series[i] ? shortDay(series[i]!.day, locale) : ""}</span>
        ))}
      </div>
      <details className="text-small">
        <summary className="flex min-h-tap cursor-pointer items-center text-jaga-text-2">
          {t("table")}
        </summary>
        <table className="mt-2 w-full text-start tabular-nums">
          <thead>
            <tr className="text-jaga-text-2">
              <th className="text-start font-medium">{t("col.day")}</th>
              <th className="text-end font-medium">{t("col.devices")}</th>
              <th className="text-end font-medium">{t("col.new")}</th>
              <th className="text-end font-medium">{t("col.sessions")}</th>
              <th className="text-end font-medium">{t("col.views")}</th>
            </tr>
          </thead>
          <tbody>
            {[...series].reverse().map((d) => (
              <tr key={d.day} className="border-t border-jaga-line">
                <td>{shortDay(d.day, locale)}</td>
                <td className="text-end">{format(d.devices)}</td>
                <td className="text-end">{format(d.newDevices)}</td>
                <td className="text-end">{format(d.sessions)}</td>
                <td className="text-end">{format(d.views)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

/**
 * A line over time with the wash under it. `dark` draws it for the navy panel. Alerts (when
 * given) are hairlines across the chart with their level written at the top, so an admin can see
 * whether people opened Jaga after one went out.
 */
export function TimeLine({
  points,
  locale,
  format,
  dark = false,
  alerts = [],
  levelName,
  height = "h-36",
  unitTip,
}: {
  points: TimePoint[];
  locale: string;
  format: (n: number) => string;
  dark?: boolean;
  alerts?: UsageData["alerts"];
  levelName?: (level: string) => string;
  height?: string;
  unitTip: (n: string) => string;
}) {
  const max = scaleMax(points.map((p) => p.n));
  const xy = chartPoints(
    points.map((p) => p.n),
    max,
  );
  const from = points[0] ? Date.parse(points[0].t) : 0;
  const to = points.length > 1 ? Date.parse(points[points.length - 1]!.t) : from + 1;
  const step = points.length > 1 ? (to - from) / (points.length - 1) : 1;
  const xOf = (iso: string) => {
    const at = Date.parse(iso);
    // chartPoints centres each value in its slot.
    return ((at - from) / step + 0.5) * (100 / Math.max(1, points.length));
  };
  const inside = alerts.filter((a) => {
    const at = Date.parse(a.at);
    return at >= from && at <= to + step;
  });
  const stroke = dark ? "stroke-jaga-teal-light" : "stroke-jaga-teal-ink";
  const fill = dark ? "fill-jaga-teal-light/15" : "fill-jaga-teal-ink/10";
  return (
    <div className={`relative ${height}`}>
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="absolute inset-0 size-full overflow-visible"
        aria-hidden="true"
      >
        <g className={dark ? motion.now : undefined}>
          <path d={areaPath(xy)} className={fill} />
          <path
            d={linePath(xy)}
            fill="none"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
            className={stroke}
          />
        </g>
        {inside.map((a) => (
          <line
            key={a.at}
            x1={xOf(a.at)}
            x2={xOf(a.at)}
            y1={0}
            y2={100}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
            className={dark ? "stroke-white/70" : "stroke-jaga-ink"}
          />
        ))}
      </svg>
      {inside.map((a) => (
        <span
          key={a.at}
          className={`absolute top-0 -translate-x-1/2 rounded px-1 text-[11px] font-bold leading-4 ${
            dark ? "bg-jaga-slate text-white" : "bg-jaga-surface text-jaga-ink"
          }`}
          style={{ left: `${Math.min(96, Math.max(4, xOf(a.at)))}%` }}
        >
          ▲ {levelName ? levelName(a.level) : a.level}
        </span>
      ))}
      {/* Hover columns: one per point, as wide as its slot. */}
      <ol className="absolute inset-0 flex" aria-hidden="true">
        {points.map((p, i) => (
          <li key={p.t} className="group relative h-full flex-1">
            <span
              className={`absolute inset-y-0 left-1/2 hidden w-px group-hover:block ${
                dark ? "bg-white/50" : "bg-jaga-text-2"
              }`}
            />
            <span
              className={`absolute left-1/2 hidden size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full group-hover:block ${
                dark ? "bg-jaga-teal-light" : "bg-jaga-teal-ink ring-2 ring-jaga-surface"
              }`}
              style={{ top: `${xy[i]!.y}%` }}
            />
            <Tip side={i < points.length / 2 ? "start" : "end"}>
              <span className="block font-bold">{dayHour(p.t, locale)}</span>
              {unitTip(format(p.n))}
            </Tip>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** When in the week people open Jaga (Bangkok time): a 7 x 24 grid, teal from light to dark. */
export function Rhythm({
  rhythm,
  locale,
  format,
}: {
  rhythm: UsageData["rhythm"];
  locale: string;
  format: (n: number) => string;
}) {
  const t = useTranslations("usage.rhythm");
  const { cells, max, peak } = rhythmGrid(rhythm);
  // 1 Jan 2024 was a Monday.
  const weekday = (d: number) =>
    new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(
      new Date(Date.UTC(2024, 0, d)),
    );
  const tone = (step: number) =>
    step === 0
      ? "var(--jaga-ground)"
      : `color-mix(in oklab, var(--jaga-teal-ink) ${[0, 18, 36, 56, 78, 100][step]}%, var(--jaga-surface))`;
  return (
    <figure className="flex flex-col gap-3" data-usage-rhythm>
      <div className="overflow-x-auto">
        <div
          className="grid min-w-[30rem] gap-[2px]"
          style={{ gridTemplateColumns: "2.5rem repeat(24, minmax(0, 1fr))" }}
          aria-hidden="true"
        >
          {cells.map((row, d) => (
            <div key={d} className="contents">
              <span className="pe-1 text-end text-small leading-5 text-jaga-text-2">
                {weekday(d + 1)}
              </span>
              {row.map((n, h) => (
                <span
                  key={h}
                  title={t("tip", {
                    day: weekday(d + 1),
                    hour: String(h).padStart(2, "0"),
                    count: format(n),
                  })}
                  className={`h-5 rounded-[3px] ${motion.cell}`}
                  style={
                    { background: tone(heatStep(n, max)), "--i": d * 24 + h } as React.CSSProperties
                  }
                />
              ))}
            </div>
          ))}
          <span />
          {Array.from({ length: 24 }, (_, h) => (
            <span key={h} className="text-center text-[11px] text-jaga-text-2">
              {h % 6 === 0 ? String(h).padStart(2, "0") : ""}
            </span>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-small text-jaga-text-2">
        <span className="flex items-center gap-1">
          {t("less")}
          {[1, 2, 3, 4, 5].map((s) => (
            <span
              key={s}
              className="inline-block size-4 rounded-[3px]"
              style={{ background: tone(s) }}
            />
          ))}
          {t("more")}
        </span>
        {peak && (
          <span className="font-medium text-jaga-ink">
            {t("peak", { day: weekday(peak.dow), hour: String(peak.hour).padStart(2, "0") })}
          </span>
        )}
      </div>
      <figcaption className="sr-only">
        {peak
          ? t("peak", { day: weekday(peak.dow), hour: String(peak.hour).padStart(2, "0") })
          : t("empty")}
      </figcaption>
    </figure>
  );
}

/** A list of things and how many phones each, one bar per row in the same teal. */
export function BarList({
  rows,
  format,
  total,
  name,
  limit = 8,
}: {
  rows: { k: string; n: number }[];
  format: (n: number) => string;
  total: number;
  name: (k: string) => string;
  limit?: number;
}) {
  const shown = rows.slice(0, limit);
  const rest = rows.slice(limit).reduce((a, r) => a + r.n, 0);
  const all = rest > 0 ? [...shown, { k: "__rest", n: rest }] : shown;
  const max = scaleMax(all.map((r) => r.n));
  const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);
  return (
    <ul className="flex flex-col gap-2">
      {all.map((r, i) => (
        <li key={r.k} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate">{name(r.k)}</span>
            <span className="shrink-0 text-small tabular-nums text-jaga-text-2">
              {format(r.n)} · {pct(r.n)}%
            </span>
          </div>
          <span className="block h-2 w-full overflow-hidden rounded-full bg-jaga-ground">
            <span
              className={`block h-full rounded-full bg-jaga-teal-ink ${motion.bar}`}
              style={
                {
                  width: `${Math.max(2, (r.n / max) * 100)}%`,
                  transformOrigin: "left",
                  "--i": i * 4,
                } as React.CSSProperties
              }
            />
          </span>
        </li>
      ))}
    </ul>
  );
}

/** From "opened Jaga" to "keeps watch for someone": each step as a share of the phones that opened it. */
export function Funnel({
  steps,
  format,
  name,
}: {
  steps: FunnelStep[];
  format: (n: number) => string;
  name: (k: string) => string;
}) {
  return (
    <ol className="flex flex-col gap-2" data-usage-funnel>
      {steps.map((s, i) => (
        <li
          key={s.key}
          className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1"
        >
          <span className="font-medium">{name(s.key)}</span>
          <span className="text-small tabular-nums text-jaga-text-2">
            {format(s.n)} · {s.share}%
          </span>
          <span className="col-span-2 block h-7 overflow-hidden rounded-lg bg-jaga-ground">
            <span
              className={`flex h-full items-center rounded-lg bg-jaga-teal-ink/85 ${motion.bar}`}
              style={
                {
                  width: `${Math.max(1.5, s.share)}%`,
                  transformOrigin: "left",
                  "--i": i * 8,
                } as React.CSSProperties
              }
            />
          </span>
        </li>
      ))}
    </ol>
  );
}

/** A figure with its name, for the tiles under each section. */
export function Tile({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string | null;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-jaga-line bg-jaga-ground/60 p-3">
      <span className="text-small text-jaga-text-2">{label}</span>
      <span className="text-h3 font-bold text-jaga-ink">{value}</span>
      {note ? <span className="text-small text-jaga-text-2">{note}</span> : null}
    </div>
  );
}

/**
 * How fast the first screen came for real people, against the 3-second budget of the spec (on
 * throttled 3G): the middle phone and the slowest quarter, on one scale to 6 seconds.
 */
export function SpeedBar({
  label,
  p50,
  p75,
  seconds,
}: {
  label: string;
  p50: number | null;
  p75: number | null;
  seconds: (ms: number) => string;
}) {
  const t = useTranslations("usage.speed");
  const at = (ms: number) => `${Math.min(100, (ms / 6000) * 100)}%`;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-medium">{label}</span>
        <span className="text-small tabular-nums text-jaga-text-2">
          {p50 !== null ? t("values", { p50: seconds(p50), p75: seconds(p75 ?? p50) }) : t("none")}
        </span>
      </div>
      <span className="relative block h-3 rounded-full bg-jaga-ground">
        {p75 !== null && (
          <span
            className="absolute inset-y-0 start-0 rounded-full bg-jaga-teal-ink/35"
            style={{ width: at(p75) }}
          />
        )}
        {p50 !== null && (
          <span
            className="absolute inset-y-0 start-0 rounded-full bg-jaga-teal-ink"
            style={{ width: at(p50) }}
          />
        )}
        <span
          className="absolute -inset-y-1 w-0.5 bg-jaga-ink"
          style={{ insetInlineStart: "50%" }}
        />
      </span>
      <span
        className="text-[11px] text-jaga-text-2"
        style={{ paddingInlineStart: "calc(50% - 1rem)" }}
      >
        {t("budget")}
      </span>
    </div>
  );
}
