"use client";

import { useTranslations } from "next-intl";
import { CheckIcon, ClockIcon, LifebuoyIcon, TriangleIcon } from "@/components/icons";
import { casesPerHour, peak, splitMinutes, type CaseState, type SosCase } from "@/lib/war-room";

/**
 * The small parts the war room is built from. Three rules hold everywhere in here:
 *  - a state is never colour alone: icon, words and colour together (docs/brand.md).
 *  - the only hue that carries a state is the SOS red, and it is always a filled badge that
 *    brings its own background, so it reads the same in the light and the dark theme. Everything
 *    else is the neutral brand tokens, which follow the theme by themselves.
 *  - counts are drawn in one teal hue. A count is not a status.
 */

const STATE_ICON = {
  overdue: TriangleIcon,
  waiting: ClockIcon,
  working: LifebuoyIcon,
  closed: CheckIcon,
};

/** Filled red for "nobody has answered"; a neutral outline for the rest. */
const STATE_CLASS: Record<CaseState, string> = {
  overdue: "bg-sos text-sos-fg",
  waiting: "border-2 border-jaga-edge bg-jaga-surface text-jaga-ink",
  working: "border-2 border-jaga-teal-ink bg-jaga-surface text-jaga-ink",
  closed: "bg-alert-stale text-alert-stale-fg",
};

export function StateBadge({
  state,
  minutes,
  unitName,
}: {
  state: CaseState;
  minutes: number;
  unitName?: string | null;
}) {
  const t = useTranslations("warRoom");
  const Icon = STATE_ICON[state];
  const { hours, minutes: mins } = splitMinutes(minutes);
  const time = hours > 0 ? t("time.hm", { hours, minutes: mins }) : t("time.m", { minutes: mins });
  const words =
    state === "overdue"
      ? t("state.overdue", { time })
      : state === "waiting"
        ? t("state.waiting", { time })
        : state === "working"
          ? t("state.working", { unit: unitName ?? "" })
          : t("state.closed");
  return (
    <span
      className={`inline-flex min-h-tap items-center gap-2 rounded-xl px-3 py-1 font-bold ${STATE_CLASS[state]}`}
    >
      <Icon size={20} />
      {words}
    </span>
  );
}

/** A fact about a case or a person: neutral, never a status. */
export function Chip({
  children,
  strong = false,
}: {
  children: React.ReactNode;
  strong?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-small ${
        strong
          ? "border-jaga-edge bg-jaga-ground font-bold text-jaga-ink"
          : "border-jaga-line bg-jaga-surface text-jaga-text-2"
      }`}
    >
      {children}
    </span>
  );
}

/** A warning on a card (no unit covers this tambon, a possible duplicate, a spam flag). */
export function Flag({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-xl border-2 border-jaga-edge bg-jaga-ground px-3 py-2 text-small font-medium text-jaga-ink">
      <TriangleIcon size={20} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

/** One counter along the top. The number is the point, so it is the biggest thing in the tile. */
export function Tile({
  label,
  value,
  note,
  urgent = false,
}: {
  label: string;
  value: number | string;
  note?: string;
  urgent?: boolean;
}) {
  return (
    <div
      className={`flex flex-col gap-0.5 rounded-2xl border bg-jaga-surface px-4 py-3 ${
        urgent ? "border-2 border-sos" : "border-jaga-line"
      }`}
    >
      <span className="text-small text-jaga-text-2">{label}</span>
      <span
        className={`text-h2 font-bold tabular-nums ${urgent ? "text-sos" : "text-jaga-ink"}`}
        // The red number is paired with the red outline and the words of the tile, never alone.
      >
        {value}
      </span>
      {note && <span className="text-small text-jaga-text-2">{note}</span>}
    </div>
  );
}

/**
 * How many SOS arrived in each of the last 24 hours. One series in one hue, so the bars mean
 * "how many", not "how bad"; the hour under the last bar and the busiest bar are labelled, and
 * every bar carries its own number for a pointer and for a screen reader.
 */
export function HourStrip({ cases, now }: { cases: SosCase[]; now: number }) {
  const t = useTranslations("warRoom");
  const buckets = casesPerHour(cases, now, 24);
  const top = peak(buckets);
  const hour = (from: number) =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Bangkok",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(new Date(from));
  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="text-small text-jaga-text-2">{t("perHour")}</figcaption>
      <div className="flex h-20 items-end gap-0.5" role="img" aria-label={t("perHour")}>
        {buckets.map((b) => (
          <div key={b.from} className="flex h-full flex-1 flex-col justify-end">
            <div
              // 2 px of surface between bars (the gap), 4 px rounded top, anchored to the baseline.
              className="rounded-t bg-jaga-teal"
              style={{ height: `${Math.max(b.count === 0 ? 2 : 8, (b.count / top) * 100)}%` }}
              title={t("perHourBar", { count: b.count, hour: hour(b.from) })}
              aria-label={t("perHourBar", { count: b.count, hour: hour(b.from) })}
            />
          </div>
        ))}
      </div>
      <div className="flex justify-between text-small tabular-nums text-jaga-text-2">
        <span>{hour(buckets[0]!.from)}</span>
        <span>{hour(buckets[12]!.from)}</span>
        <span>{t("now", { hour: hour(buckets[23]!.from) })}</span>
      </div>
    </figure>
  );
}
