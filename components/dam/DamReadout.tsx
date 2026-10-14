"use client";

import type { CSSProperties, ReactNode } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { type Dam } from "@/lib/dam";
import { BANGKOK_DAY } from "@/lib/time";
import {
  changeOf,
  DIAL_START,
  dialAngle,
  dialDash,
  flowNow,
  fullnessOf,
  storageNow,
  type FlowNow,
  type StorageNow,
} from "@/lib/dam-readout";
import styles from "./DamReadout.module.css";

/** The words this panel reads, as next-intl hands them over. */
type Words = (key: string, values?: Record<string, number | string>) => string;

/*
 * The instrument panel at the head of a reservoir's report (the owner, 14 Oct 2026: an awe
 * experience for the reader who knows the technical side).
 *
 * What makes it worth that reader: every figure carries its unit and its datum; the fullness is
 * given against **both** denominators (the maximum, and the capacity at normal high water that
 * Thai bulletins quote), with the dial marking where normal high water sits; inflow and outflow
 * say whether they are one hour or a mean and how many readings are behind them; and the change
 * in storage is the rate measured from the readings themselves.
 *
 * What it is careful not to be: an alert. It is brand slate and teal, which never carry a status
 * (docs/brand.md); the state stays in the chip above it, and the card's own line still says these
 * are the dam's own figures, not a level Jaga issued (safety rule 2). Nothing here is modelled or
 * forecast - it is arithmetic on what the operator published, and the hour it belongs to is
 * written under it by the card (safety rule 8).
 */

/**
 * Million cubic metres, grouped as this language groups thousands. A small reservoir holds only a
 * few, so whole numbers there would read as 0; a big one is written to the nearest million.
 */
function mcmText(format: ReturnType<typeof useFormatter>, mcm: number): string {
  return format.number(mcm, {
    maximumFractionDigits: mcm < 10 ? 1 : 0,
    minimumFractionDigits: mcm < 10 ? 1 : 0,
  });
}

function Note({ children }: { children: ReactNode }) {
  return <span className="text-small text-white/70">{children}</span>;
}

function Cell({
  step,
  label,
  value,
  unit,
  notes,
  tall = false,
}: {
  step: number;
  label: string;
  value: string;
  unit: string;
  notes?: ReactNode;
  /** The storage cell carries the most under it; it takes two rows so the rest close up. */
  tall?: boolean;
}) {
  return (
    <div
      className={`${styles.cell} ${tall ? "sm:row-span-2" : ""}`}
      style={{ "--step": step } as CSSProperties}
    >
      <dt className="text-small text-white/70">{label}</dt>
      <dd className="flex flex-col">
        <span>
          {/* Tabular figures, so a column of readings lines up under one another. */}
          <span className="text-h3 font-bold tabular-nums text-white">{value}</span>{" "}
          <span className="text-small text-white/70">{unit}</span>
        </span>
        {notes}
      </dd>
    </div>
  );
}

function Dial({
  fraction,
  percent,
  mark,
  label,
}: {
  fraction: number;
  percent: number;
  mark: number | null;
  label: string;
}) {
  const size = 132;
  const centre = size / 2;
  const radius = 54;
  const dash = dialDash(fraction, radius);
  const shown = Number(dash.value.split(" ")[0]);
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      height={size}
      role="img"
      aria-label={`${label}: ${percent}%`}
      className="shrink-0"
      data-dam-dial={percent}
    >
      <g transform={`rotate(${DIAL_START} ${centre} ${centre})`} fill="none">
        <circle
          cx={centre}
          cy={centre}
          r={radius}
          strokeDasharray={dash.track}
          strokeWidth={11}
          strokeLinecap="round"
          className="stroke-white/15"
        />
        <circle
          cx={centre}
          cy={centre}
          r={radius}
          strokeDasharray={dash.value}
          strokeWidth={11}
          strokeLinecap="round"
          className={`stroke-jaga-teal-light ${styles.dialValue}`}
          style={{ "--dial-dash": `${shown}px` } as CSSProperties}
        />
        {/* Normal high water on the dial's own scale: the mark the bulletins measure against. */}
        {mark !== null && (
          <line
            x1={centre + radius - 9}
            y1={centre}
            x2={centre + radius + 9}
            y2={centre}
            strokeWidth={2}
            className="stroke-white/80"
            transform={`rotate(${dialAngle(mark) - DIAL_START} ${centre} ${centre})`}
          />
        )}
      </g>
      <text
        x={centre}
        y={centre + 4}
        textAnchor="middle"
        className="fill-white text-h2 font-bold tabular-nums"
      >
        {percent}%
      </text>
    </svg>
  );
}

export function DamReadout({ dam }: { dam: Dam }) {
  const t = useTranslations("dam.readout");
  const format = useFormatter();
  const signal = dam.signal;
  // With no figures at all there is no instrument to draw; the card says so in words instead.
  if (!signal) return null;
  const storage = storageNow(dam);
  const full = fullnessOf(dam, storage);
  const inflow = flowNow(dam, "inflow");
  const outflow = flowNow(dam, "outflow");
  const change = changeOf(signal);
  const spill = signal.spilledCms;
  /* Where the stored volume came from: this hour, or the newest figure of a named day. */
  const storageFrom =
    storage === null ? null : storage.from === "hour" ? t("fromHour") : dayNote(t, format, storage);
  let step = 0;
  return (
    <section
      className={`relative isolate flex flex-col gap-3 overflow-hidden rounded-2xl p-4 ${styles.panel}`}
      data-dam-readout={dam.code}
    >
      <h3 className="text-small font-medium tracking-wide text-white/70 uppercase">{t("title")}</h3>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        {full && (
          <div className="flex flex-col items-center gap-1 self-center sm:self-start">
            <Dial
              fraction={full.ofMax}
              percent={full.percentMax}
              mark={full.normalMark}
              label={t("dial")}
            />
            {full.normalMark !== null && (
              <p className="max-w-40 text-center text-small text-white/70">
                {t("normalMark", { percent: Math.round(full.normalMark * 100) })}
              </p>
            )}
          </div>
        )}
        <dl className="grid flex-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {storage && (
            <Cell
              step={step++}
              tall
              label={t("storage")}
              value={mcmText(format, storage.mcm)}
              unit={t("unit.mcm")}
              notes={
                <>
                  {full && <Note>{t("ofMax", { percent: full.percentMax })}</Note>}
                  {full?.percentNormal != null && (
                    <Note>{t("ofNormal", { percent: full.percentNormal })}</Note>
                  )}
                  {full?.roomToNormalMcm != null && full.roomToNormalMcm > 0 && (
                    <Note>{t("room", { mcm: full.roomToNormalMcm })}</Note>
                  )}
                  {storageFrom && <Note>{storageFrom}</Note>}
                </>
              }
            />
          )}
          {storage?.levelM != null && (
            <Cell
              step={step++}
              label={t("level")}
              value={storage.levelM.toFixed(2)}
              unit={t("unit.m")}
              notes={storageFrom && <Note>{storageFrom}</Note>}
            />
          )}
          {inflow && <Flow step={step++} label={t("inflow")} flow={inflow} t={t} format={format} />}
          {outflow && (
            <Flow step={step++} label={t("outflow")} flow={outflow} t={t} format={format}>
              {spill !== null && spill > 0 && <Note>{t("spill", { cms: Math.round(spill) })}</Note>}
            </Flow>
          )}
          {change && (
            <Cell
              step={step++}
              label={t("change")}
              value={`${sign(change.mcmPerH)}${Math.abs(change.mcmPerH).toFixed(2)}`}
              unit={t("unit.mcmPerH")}
              notes={
                <>
                  {/* The sign carries the direction, so the word is there for a reader too. */}
                  <span className="sr-only">{t(`way.${change.way}`)}</span>
                  <Note>{t("over", { hours: change.windowH })}</Note>
                </>
              }
            />
          )}
        </dl>
      </div>
    </section>
  );
}

/**
 * A flow, with the day's mean beside it where the figure above is one hour. The two answer
 * different questions, and an hour of 0 next to a day that passed 3.6 million m³ is exactly the
 * pair a reader needs to see together.
 */
function Flow({
  step,
  label,
  flow,
  t,
  format,
  children,
}: {
  step: number;
  label: string;
  flow: FlowNow;
  t: Words;
  format: ReturnType<typeof useFormatter>;
  children?: ReactNode;
}) {
  return (
    <Cell
      step={step}
      label={label}
      value={format.number(Math.round(flow.cms))}
      unit={t("unit.cms")}
      notes={
        <>
          <Note>{flow.from === "hour" ? t("fromHour") : t("fromMean", { hours: flow.hours })}</Note>
          {flow.meanCms !== null && (
            <Note>{t("dayMean", { hours: flow.meanHours, cms: Math.round(flow.meanCms) })}</Note>
          )}
          {children}
        </>
      }
    />
  );
}

/** Which day a figure from the daily series belongs to, written as the reader's calendar. */
function dayNote(t: Words, format: ReturnType<typeof useFormatter>, storage: StorageNow): string {
  return t("fromDay", {
    day: storage.day ? format.dateTime(new Date(`${storage.day}T00:00:00+07:00`), BANGKOK_DAY) : "",
  });
}

/** A true minus sign, not a hyphen: this is a measured rate, written as a hydrologist writes it. */
function sign(rate: number): string {
  if (rate > 0) return "+";
  return rate < 0 ? "−" : "";
}
