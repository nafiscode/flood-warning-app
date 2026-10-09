"use client";

import { useTranslations } from "next-intl";
import { CheckIcon } from "@/components/icons";
import { barPercent, percent } from "@/lib/impact";

/**
 * The parts the impact dashboard is drawn from. Four rules hold in all of them:
 *
 *  - **One hue for every magnitude.** Jaga has a single brand hue, so any two steps of it are
 *    too close for a reader with normal colour vision to tell apart (checked with the palette
 *    validator: adjacent ΔE about 10, below the floor of 15). So nothing here encodes identity
 *    by colour: every bar is `jaga-teal-ink`, and what a bar *is* is written beside it. Length
 *    carries the magnitude, words carry the identity.
 *  - **The alert palette is never used.** Those colours mean an alert level (docs/brand.md), and
 *    a count is not a status - not even the count of requests nobody answered.
 *  - **Both themes come free**, because every colour is a brand token: `jaga-teal-ink` is the
 *    dark teal by day and the light teal after dark, and both pass 3:1 against their own page.
 *  - **Every chart has its numbers in words too**: a bar is `aria-hidden` decoration beside a
 *    figure that is already readable, and the column chart carries a table.
 */

const TRACK = "h-3 w-full overflow-hidden rounded bg-jaga-ground";
const FILL = "h-full rounded-e bg-jaga-teal-ink";

/** A headline figure. No plot, so no hover layer: the number is the whole mark. */
export function StatTile({
  value,
  label,
  note,
  wide = false,
}: {
  value: string;
  label: string;
  note?: string;
  wide?: boolean;
}) {
  return (
    <div
      className={`flex flex-col gap-1 rounded-2xl border border-jaga-line bg-jaga-surface p-4 ${
        wide ? "sm:col-span-2" : ""
      }`}
    >
      <span className="text-h2 font-bold tabular-nums text-jaga-ink">{value}</span>
      <span className="font-medium">{label}</span>
      {note ? <span className="text-small text-jaga-text-2">{note}</span> : null}
    </div>
  );
}

/**
 * One labelled bar: the label and the number are always visible, the bar only repeats them for
 * the eye. Used for outcomes, waiting bands and per-province counts.
 */
export function BarRow({
  label,
  value,
  max,
  note,
  share,
}: {
  label: string;
  value: string;
  max: number;
  note?: string;
  /** The raw count, when a bar should be drawn for it. */
  share?: number;
}) {
  const width = share === undefined ? 0 : barPercent(share, max);
  return (
    <div className="flex flex-col gap-1 py-1">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums text-jaga-text-2">{value}</span>
      </div>
      <div className={TRACK} aria-hidden="true">
        <div className={FILL} style={{ width: `${width}%` }} />
      </div>
      {note ? <span className="text-small text-jaga-text-2">{note}</span> : null}
    </div>
  );
}

/**
 * Requests per week, with the share the teams confirmed drawn inside the same column: the teal
 * part is the confirmed rescues, the neutral part above it the rest of the requests. One hue
 * plus a neutral, a 2px gap between the two fills, and the figures in the table below.
 */
export function WeekColumns({
  weeks,
  weekLabel,
}: {
  weeks: { from: string; requests: number; confirmed: number }[];
  weekLabel: (from: string) => string;
}) {
  const t = useTranslations("impact");
  const max = weeks.reduce((a, w) => (w.requests > a ? w.requests : a), 0);
  return (
    <figure className="m-0 flex flex-col gap-3">
      <ul className="flex h-40 list-none items-end gap-1 p-0" aria-hidden="true">
        {weeks.map((week) => {
          const tall = max > 0 ? Math.max(2, Math.round((100 * week.requests) / max)) : 0;
          const inner = percent(week.confirmed, week.requests);
          return (
            <li key={week.from} className="flex h-full flex-1 flex-col justify-end">
              <span
                className="flex w-full flex-col justify-end gap-[2px] rounded-t bg-jaga-line"
                style={{ height: `${tall}%` }}
                title={t("season.weekTip", {
                  week: weekLabel(week.from),
                  requests: week.requests,
                  confirmed: week.confirmed,
                })}
              >
                <span
                  className="w-full rounded-t bg-jaga-teal-ink"
                  style={{ height: `${inner}%` }}
                />
              </span>
            </li>
          );
        })}
      </ul>
      <figcaption className="flex flex-wrap gap-x-4 gap-y-1 text-small text-jaga-text-2">
        <span className="inline-flex items-center gap-2">
          <span className="size-3 rounded-sm bg-jaga-teal-ink" aria-hidden="true" />
          {t("season.legendConfirmed")}
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="size-3 rounded-sm bg-jaga-line" aria-hidden="true" />
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

/** The numbers behind a chart, for anyone who would rather read them (or cannot see the bars). */
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

/** How far a unit is from its next milestone: a bar it can fill, and how many are missing. */
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
