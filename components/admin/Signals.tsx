import type { ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import { RefreshEvery } from "@/components/admin/RefreshEvery";
import { SignalsMap, type MapPoint } from "@/components/admin/SignalsMap";
import {
  coastalGate,
  slowReturn,
  type Gate,
  type GateReference,
} from "@/lib/coastal-gate";
import {
  FORECAST_STALE_H,
  gaugeNow,
  gaugeState,
  keyLevelsFor,
  mapLevels,
  LEVELS,
  linePath,
  rainBetween,
  rainNow,
  returnSpan,
  SIGNAL_KEYS,
  span,
  suggest,
  thresholdOf,
  type AutoEvent,
  type Feed,
  type Gauge,
  type Level,
  type Point,
  type Signals,
  type Zone,
} from "@/lib/signals";
import { buttonPrimary, buttonSecondary, card, hint, input, label } from "@/lib/ui";

/**
 * The signal dashboard (spec 6.3). Server-rendered and plain: charts are SVG, the only form is a
 * native one. Colour carries no meaning here. Every series is the one brand ink, reference lines
 * are grey and named in words, and the suggested level is written out in an outlined box, never
 * in an alert badge: an alert badge means a person issued that level, and nobody has.
 */

type T = (key: string, values?: Record<string, string | number>) => string;
const HOUR = 3_600_000;
const BKK = "Asia/Bangkok";

function when(locale: string, at: number): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: BKK,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(at));
}
function dayLabel(locale: string, at: number): string {
  return new Intl.DateTimeFormat(locale, { timeZone: BKK, day: "numeric", month: "short" }).format(
    new Date(at),
  );
}
/** Midnights (Bangkok) between two moments, for the day ticks. */
function midnights(from: number, to: number): number[] {
  const out: number[] = [];
  const first = Math.ceil((from + 7 * HOUR) / (24 * HOUR)) * 24 * HOUR - 7 * HOUR;
  for (let t = first; t <= to; t += 24 * HOUR) out.push(t);
  return out;
}
const fix = (v: number, digits = 2) => v.toFixed(digits);
const localName = (name: Record<string, string | null | undefined>, locale: string) =>
  name[locale] || name.th || name.en || "";

type Ref = { value: number; text: string };

function Chart({
  series,
  bars = false,
  refs = [],
  from,
  to,
  now,
  locale,
  nowText,
  height = "h-40",
  emptyText,
  gapH = 4,
}: {
  series: Point[];
  bars?: boolean;
  refs?: Ref[];
  from: number;
  to: number;
  now: number;
  locale: string;
  nowText: string;
  height?: string;
  emptyText: string;
  /** Readings further apart than this many hours are not joined by the line. */
  gapH?: number;
}) {
  const inside = series.filter(([t]) => t >= from && t <= to);
  if (inside.length === 0) return <p className={hint}>{emptyText}</p>;
  const [lo, hi] = bars
    ? [0, Math.max(1, ...inside.map((p) => p[1])) * 1.1]
    : span([...inside.map((p) => p[1]), ...refs.map((r) => r.value)]);
  const x = (t: number) => ((t - from) / (to - from)) * 100;
  const y = (v: number) => 100 - ((v - lo) / (hi - lo)) * 100;
  const width = (100 / ((to - from) / HOUR)) * 0.8;
  const days = midnights(from, to);
  return (
    <div className="flex flex-col gap-1">
      <div className={`relative ${height} rounded-lg border border-jaga-line bg-jaga-ground`}>
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full"
          aria-hidden="true"
        >
          {days.map((t) => (
            <line
              key={t}
              x1={x(t)}
              x2={x(t)}
              y1="0"
              y2="100"
              className="stroke-jaga-line"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {bars ? (
            inside.map(([t, v]) => (
              <rect
                key={t}
                x={x(t) - width}
                width={width}
                y={y(v)}
                height={100 - y(v)}
                className="fill-jaga-teal-ink"
                opacity={t > now ? 0.4 : 1}
              />
            ))
          ) : (
            <path
              d={linePath(inside, x, y, gapH)}
              fill="none"
              className="stroke-jaga-teal-ink"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />
          )}
          {refs.map((r) => (
            <line
              key={r.text}
              x1="0"
              x2="100"
              y1={y(r.value)}
              y2={y(r.value)}
              className="stroke-jaga-text-2"
              strokeWidth="1"
              strokeDasharray="4 3"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {now > from && now < to && (
            <line
              x1={x(now)}
              x2={x(now)}
              y1="0"
              y2="100"
              className="stroke-jaga-ink"
              strokeWidth="1.5"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
        {refs.map((r) => (
          <span
            key={r.text}
            className="absolute end-1 -translate-y-full rounded bg-jaga-surface/85 px-1 text-[11px] leading-4 text-jaga-text-2"
            style={{ top: `${y(r.value)}%` }}
          >
            {r.text}
          </span>
        ))}
        {now > from && now < to && (
          <span
            className="absolute bottom-0 rounded bg-jaga-surface/85 px-1 text-[11px] leading-4 text-jaga-ink"
            style={
              x(now) > 80
                ? { insetInlineEnd: `${100 - x(now)}%` }
                : { insetInlineStart: `${x(now)}%` }
            }
          >
            {nowText}
          </span>
        )}
      </div>
      <div className="relative h-4 text-[11px] text-jaga-text-2" aria-hidden="true">
        {days
          .filter((_, i) => i % Math.ceil(days.length / 4) === 0)
          .map((t) => (
            <span
              key={t}
              className="absolute whitespace-nowrap"
              style={{ insetInlineStart: `${x(t)}%` }}
            >
              {dayLabel(locale, t)}
            </span>
          ))}
      </div>
    </div>
  );
}

function Figure({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="flex flex-col">
      <dt className={hint}>{name}</dt>
      <dd className="font-bold text-jaga-ink">{children}</dd>
    </div>
  );
}

function GaugeBlock({
  gauge,
  role,
  zone,
  now,
  locale,
  t,
  autoAction,
}: {
  gauge: Gauge;
  role: "key" | "upstream";
  zone: Zone;
  now: number;
  locale: string;
  t: T;
  autoAction?: (form: FormData) => void;
}) {
  const state = gaugeNow(gauge, now);
  const refs: Ref[] = [];
  if (gauge.bank !== null)
    refs.push({ value: gauge.bank, text: t("ref.bank", { value: fix(gauge.bank) }) });
  const warning =
    role === "key" ? thresholdOf(zone, "key_level_m", "warning") : (gauge.levels?.warning ?? null);
  if (warning !== null && warning !== gauge.bank)
    refs.push({ value: warning, text: t("ref.warning", { value: fix(warning) }) });
  const watch =
    role === "key" ? thresholdOf(zone, "key_level_m", "watch") : (gauge.levels?.watch ?? null);
  if (watch !== null) refs.push({ value: watch, text: t("ref.watch", { value: fix(watch) }) });
  return (
    <section className="flex flex-col gap-2" data-signal-gauge={gauge.code}>
      <h3 className="font-bold text-jaga-ink">
        {t(`gauge.${role}`)}: {gauge.code} {localName(gauge.name, locale)}
        {gauge.agency ? <span className={`${hint} ms-2 font-normal`}>{gauge.agency}</span> : null}
      </h3>
      {state ? (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
          <Figure name={t("gauge.level")}>
            {t("gauge.levelValue", { value: fix(state.value) })}
          </Figure>
          <Figure name={t("gauge.measured")}>
            {when(locale, state.at)}
            {state.stale ? (
              <span
                className="ms-2 rounded border border-jaga-edge px-1 text-small font-normal"
                data-signal-stale
              >
                {t("gauge.stale", { hours: Math.round(state.ageH) })}
              </span>
            ) : null}
          </Figure>
          <Figure name={t("gauge.rise")}>
            {state.riseM === null
              ? t("unknown")
              : t("gauge.riseValue", {
                  value: `${state.riseM >= 0 ? "+" : ""}${fix(state.riseM)}`,
                })}
          </Figure>
          <Figure name={t("gauge.toBank")}>
            {state.belowBankM === null
              ? t("unknown")
              : state.belowBankM > 0
                ? t("gauge.below", { value: fix(state.belowBankM) })
                : t("gauge.over", { value: fix(-state.belowBankM) })}
          </Figure>
        </dl>
      ) : (
        <p className={hint}>{t("gauge.none")}</p>
      )}
      <Chart
        series={gauge.series}
        refs={refs}
        from={now - 96 * HOUR}
        to={now + 2 * HOUR}
        now={now}
        locale={locale}
        nowText={t("now")}
        emptyText={t("gauge.noSeries")}
      />
      {gauge.series.length > 0 && gauge.series.length < 3 ? (
        <p className={hint}>{t("gauge.few", { count: gauge.series.length })}</p>
      ) : null}
      {gauge.id ? <AutoTick gauge={gauge} t={t} action={autoAction} /> : null}
    </section>
  );
}

function FeedLine({
  name,
  feed,
  now,
  locale,
  t,
}: {
  name: string;
  feed: Feed;
  now: number;
  locale: string;
  t: T;
}) {
  if (!feed) return <li>{t("feed.never", { name })}</li>;
  const hours = (now - feed.at) / HOUR;
  return (
    <li>
      {t(feed.ok ? "feed.ok" : "feed.failed", { name, time: when(locale, feed.at) })}
      {hours > FORECAST_STALE_H ? ` ${t("feed.old", { hours: Math.round(hours) })}` : ""}
      {feed.error ? <span className={hint}> {feed.error}</span> : null}
    </li>
  );
}

/**
 * The readings behind a suggestion, as the alert's note. The note is shown as typed in every
 * language, so it is figures and gauge codes only: "X.40A 16.20 m (+0.94 m / 6 h) 26/11 09:00 ·
 * rain 72 h 240 mm".
 */
export function draftNote(zone: Zone, now: number, locale: string): string {
  const parts: string[] = [];
  const stamp = (at: number) =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone: BKK,
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .format(new Date(at))
      .replace(",", "");
  for (const gauge of [zone.key, zone.upstream]) {
    const st = gaugeNow(gauge, now);
    if (!gauge || !st || st.stale) continue;
    const rise = st.riseM === null ? "" : ` (${st.riseM >= 0 ? "+" : ""}${fix(st.riseM)} m / 6 h)`;
    parts.push(`${gauge.code} ${fix(st.value)} m${rise} ${stamp(st.at)}`);
  }
  const rain = rainNow(zone.rain, now);
  if (rain.hasPast) parts.push(`rain 72 h ${fix(rain.past72, 0)} mm`);
  void locale;
  return parts.join(" · ").slice(0, 400);
}

function ZoneCard({
  zone,
  gate,
  now,
  locale,
  t,
  action,
  autoAction,
  levelsAction,
  saved,
}: {
  zone: Zone;
  gate: Gate | null;
  now: number;
  locale: string;
  t: T;
  action?: (form: FormData) => void;
  autoAction?: (form: FormData) => void;
  levelsAction?: (form: FormData) => void;
  saved: boolean;
}) {
  const s = suggest(zone, now);
  const rain = rainNow(zone.rain, now);
  const rainRefs = (signal: "rain_72h_mm" | "rain_24h_mm") =>
    LEVELS.flatMap((l) => {
      const v = thresholdOf(zone, signal, l);
      return v === null ? [] : [`${t(`level.${l}`)} ${v} mm`];
    }).join(", ");
  const discharge = zone.discharge;
  const tide = zone.tide;
  return (
    <article className={card} data-signal-zone={zone.basin} data-suggested={s.level ?? "none"}>
      <header className="flex flex-col gap-2">
        <h2 className="text-h3 font-bold text-jaga-ink">{localName(zone.name, locale)}</h2>
        <div
          className="flex flex-col gap-2 rounded-xl border-2 border-jaga-edge p-3"
          data-signal-suggestion
        >
          <p className={hint}>{t("suggestion.title")}</p>
          <p className="text-h3 font-bold text-jaga-ink">
            {s.level ? t(`level.${s.level}`) : t("suggestion.none")}
          </p>
          {s.reasons.length > 0 && (
            <ul className="list-disc ps-5">
              {s.reasons.map((r) => (
                <li key={r.kind}>
                  {t(`reason.${r.kind}`, {
                    value: fix(r.value, r.kind.startsWith("rain") ? 0 : 2),
                    threshold: fix(r.threshold, r.kind.startsWith("rain") ? 0 : 2),
                    level: t(`level.${r.level}`),
                    time: r.at ? when(locale, r.at) : "",
                  })}
                </li>
              ))}
            </ul>
          )}
          {s.blind.length > 0 && (
            <ul className={`${hint} list-disc ps-5`} data-signal-blind>
              {s.blind.map((b) => (
                <li key={b}>{t(`blind.${b}`)}</li>
              ))}
            </ul>
          )}
          <p className={hint}>{t("suggestion.onlyAdvice")}</p>
          <Link
            href={{
              pathname: "/admin/alerts/new",
              query: {
                zone: zone.id,
                ...(s.level ? { level: s.level } : {}),
                note: draftNote(zone, now, locale),
              },
            }}
            className={`${buttonSecondary} self-start`}
            data-draft-alert
          >
            {t("suggestion.toAlerts")}
          </Link>
        </div>
      </header>

      {zone.key ? (
        <GaugeBlock
          gauge={zone.key}
          role="key"
          zone={zone}
          now={now}
          locale={locale}
          t={t}
          autoAction={autoAction}
        />
      ) : (
        <p className={hint}>{t("gauge.noKey")}</p>
      )}
      {zone.upstream ? (
        <GaugeBlock
          gauge={zone.upstream}
          role="upstream"
          zone={zone}
          now={now}
          locale={locale}
          t={t}
          autoAction={autoAction}
        />
      ) : null}
      {zone.others.length > 0 && (
        <section className="flex flex-col gap-1">
          <h3 className="font-bold text-jaga-ink">{t("gauge.others")}</h3>
          <ul className="flex flex-col gap-1">
            {zone.others.map((g) => {
              const st = gaugeNow(g, now);
              return (
                <li key={g.code}>
                  {g.code} {localName(g.name, locale)}:{" "}
                  {st
                    ? `${t("gauge.levelValue", { value: fix(st.value) })}, ${when(locale, st.at)}${
                        st.belowBankM === null
                          ? ""
                          : `, ${st.belowBankM > 0 ? t("gauge.below", { value: fix(st.belowBankM) }) : t("gauge.over", { value: fix(-st.belowBankM) })}`
                      }${st.stale ? `, ${t("gauge.stale", { hours: Math.round(st.ageH) })}` : ""}`
                    : t("gauge.none")}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-2" data-signal-rain>
        <h3 className="font-bold text-jaga-ink">{t("rain.title")}</h3>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
          <Figure name={t("rain.past24")}>{t("mm", { value: fix(rain.past24, 0) })}</Figure>
          <Figure name={t("rain.past72")}>{t("mm", { value: fix(rain.past72, 0) })}</Figure>
          <Figure name={t("rain.next24")}>{t("mm", { value: fix(rain.next24, 0) })}</Figure>
          {zone.rainWettest && zone.rainWettest.length > 0 ? (
            <Figure name={t("rain.nextWettest")}>
              {t("mm", {
                value: fix(rainBetween(zone.rainWettest, now, now + 72 * HOUR), 0),
              })}
            </Figure>
          ) : null}
          <Figure name={t("rain.peak72")}>
            {t("mm", { value: fix(rain.peak72, 0) })}
            {rain.peak72At ? (
              <span className={`${hint} ms-1 font-normal`}>
                {t("rain.by", { time: when(locale, rain.peak72At) })}
              </span>
            ) : null}
          </Figure>
        </dl>
        <Chart
          series={zone.rain}
          bars
          from={now - 72 * HOUR}
          to={now + 120 * HOUR}
          now={now}
          locale={locale}
          nowText={t("now")}
          height="h-28"
          emptyText={t("rain.none")}
        />
        <p className={hint}>
          {t("rain.thresholds", {
            r72: rainRefs("rain_72h_mm") || t("thresholds.unset"),
            r24: rainRefs("rain_24h_mm") || t("thresholds.unset"),
          })}
        </p>
        <p className={hint}>{t("rain.caveat")}</p>
      </section>

      <div className="grid gap-4 sm:grid-cols-2">
        <section className="flex flex-col gap-2">
          <h3 className="font-bold text-jaga-ink">{t("discharge.title")}</h3>
          <Chart
            series={discharge}
            gapH={36}
            from={now - 7 * 24 * HOUR}
            to={now + 7 * 24 * HOUR}
            now={now}
            locale={locale}
            nowText={t("now")}
            height="h-24"
            emptyText={t("discharge.none")}
          />
          <p className={hint}>{t("discharge.caveat")}</p>
        </section>
        <section className="flex flex-col gap-2">
          <h3 className="font-bold text-jaga-ink">{t("tide.title")}</h3>
          <Chart
            series={tide}
            from={now - 24 * HOUR}
            to={now + 72 * HOUR}
            now={now}
            locale={locale}
            nowText={t("now")}
            height="h-24"
            emptyText={t("tide.none")}
          />
          <p className={hint}>{t("tide.caveat")}</p>
          <GatePanel gate={gate} locale={locale} t={t} />
        </section>
      </div>
      {zone.forecastIssuedAt ? (
        <p className={hint}>{t("forecastAt", { time: when(locale, zone.forecastIssuedAt) })}</p>
      ) : null}

      <RecessionBlock zone={zone} gate={gate} t={t} />

      <details
        className="rounded-xl border border-jaga-line p-3"
        data-signal-thresholds
        open={saved}
      >
        <summary className="min-h-tap cursor-pointer font-bold text-jaga-ink">
          {t("thresholds.title")}
        </summary>
        <div className="flex flex-col gap-4 pt-2">
          <p className={hint}>{t("thresholds.intro")}</p>
          {SIGNAL_KEYS.filter((k) => k.startsWith("rain")).map((signal) => {
            const th = zone.thresholds.find((x) => x.signal === signal);
            return (
              <form
                key={signal}
                action={action}
                className="flex flex-col gap-2 border-t border-jaga-line pt-3"
                data-threshold-form={signal}
              >
                <input type="hidden" name="zone" value={zone.id} />
                <input type="hidden" name="signal" value={signal} />
                <p className="font-bold">
                  {t(`signal.${signal}`)}{" "}
                  <span className={`${hint} font-normal`}>
                    {th
                      ? th.provisional
                        ? t("thresholds.provisional")
                        : t("thresholds.byHand", {
                            time: th.updatedAt ? when(locale, th.updatedAt) : "",
                          })
                      : t("thresholds.unset")}
                  </span>
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {(signal === "rain_72h_forecast_mm" ? (["watch"] as const) : LEVELS).map(
                    (level) => (
                      <label key={level} className="flex flex-col gap-1">
                        <span className={label}>{t(`level.${level}`)}</span>
                        <input
                          className={input}
                          name={level}
                          inputMode="decimal"
                          defaultValue={th?.levels[level] ?? ""}
                        />
                      </label>
                    ),
                  )}
                </div>
                {action ? (
                  <button type="submit" className={`${buttonPrimary} self-start`}>
                    {t("thresholds.save")}
                  </button>
                ) : null}
              </form>
            );
          })}
          <p className="border-t border-jaga-line pt-3 font-bold text-jaga-ink">
            {t("thresholds.gauges")}
          </p>
          <p className={hint}>{t("thresholds.gaugesIntro")}</p>
          {(
            [
              ...(zone.key ? [[zone.key, "key"] as const] : []),
              ...(zone.upstream ? [[zone.upstream, "upstream"] as const] : []),
              ...zone.others.map((g) => [g, "other"] as const),
            ] as const
          ).map(([gauge, role]) => (
            <GaugeLevelsBox
              key={gauge.code}
              gauge={gauge}
              role={role}
              zone={zone}
              locale={locale}
              t={t}
              action={levelsAction}
            />
          ))}
        </div>
      </details>
    </article>
  );
}

/**
 * One gauge's Watch, Warning and Evacuate, prefilled with what is stored (the pipeline's suggestion
 * or an admin's own figure). For the key and upstream gauge these are the zone's own level
 * thresholds: saving here changes both, so there is one value, not two.
 */
function spanText(t: T, low: number, high: number): string {
  const a = returnSpan(low, "low");
  const b = returnSpan(high, "high");
  if (a.unit === b.unit) return t(`recession.${a.unit}Range`, { from: a.value, to: b.value });
  return t("recession.mixedRange", {
    from: t(`recession.${a.unit}`, { n: a.value }),
    to: t(`recession.${b.unit}`, { n: b.value }),
  });
}

function median(t: T, hours: number): string {
  const m = returnSpan(hours);
  return t(`recession.${m.unit}`, { n: m.value });
}

/**
 * How fast past floods fell back at the zone's gauges (science plan Module 5): the record an admin
 * reads before writing a Return alert's window. Never a forecast, so no colour and no level.
 */
/**
 * The coastal gate (science plan Module 10): what the sea's low water is doing to this river's way
 * out. Written out in words beside the tide chart, never as a level and never in an alert colour -
 * it cannot raise anything and it cannot publish (safety rule 2). A state of `open` is still shown,
 * because "the sea is letting the river out" is worth knowing when deciding a return window.
 */
function GatePanel({ gate, locale, t }: { gate: Gate | null; locale: string; t: T }) {
  if (!gate) return <p className={hint}>{t("gate.none")}</p>;
  const { state, days, shutRun, shutFrom, reference } = gate;
  const line = reference.llw.p90;
  const metre = (v: number) => v.toFixed(2);
  return (
    <div
      className="flex flex-col gap-2 rounded-xl border border-jaga-line p-3"
      data-signal-gate={state}
      data-signal-gate-mouth={reference.id}
    >
      <h4 className="font-bold text-jaga-ink">{t("gate.title")}</h4>
      <p className="font-bold" data-gate-state>
        {t(`gate.state.${state}`)}
      </p>
      <p className={hint}>
        {state === "shut" && shutFrom !== null
          ? t("gate.shutRun", { days: shutRun, from: dayLabel(locale, shutFrom) })
          : state === "narrowing"
            ? t("gate.narrowingLine")
            : state === "open"
              ? t("gate.openLine")
              : t("gate.unknownLine")}
      </p>
      <p className={hint}>{t("gate.meaning")}</p>
      {days.length > 0 ? (
        <>
          <p className={hint}>{t("gate.days")}</p>
          <ul className="list-disc ps-5">
            {days.map((d) => (
              <li key={d.at} data-gate-day={d.shut ? "shut" : "open"}>
                {t("gate.day", {
                  day: dayLabel(locale, d.at),
                  low: metre(d.low),
                  high: metre(d.high),
                })}
                {d.shut ? <span className={`${hint} ps-1`}>({t("gate.dayShut")})</span> : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {line !== null ? (
        <p className={hint}>
          {t("gate.line", { line: metre(line), days: reference.seasonDays })}
        </p>
      ) : null}
      <p className={hint}>{t("gate.intro")}</p>
      <p className={hint}>{t("gate.caveat")}</p>
    </div>
  );
}

function RecessionBlock({ zone, gate, t }: { zone: Zone; gate: Gate | null; t: T }) {
  const gauges = [
    ...(zone.key ? [[zone.key, "key"] as const] : []),
    ...(zone.upstream ? [[zone.upstream, "upstream"] as const] : []),
    ...zone.others.map((g) => [g, "other"] as const),
  ].filter(([g]) => g.recession && g.recession.events > 0);
  if (gauges.length === 0) return null;
  return (
    <details className="rounded-xl border border-jaga-line p-3" data-signal-recession>
      <summary className="min-h-tap cursor-pointer font-bold text-jaga-ink">
        {t("recession.title")}
      </summary>
      <div className="flex flex-col gap-3 pt-2">
        <p className={hint}>{t("recession.intro")}</p>
        <ul className="flex flex-col gap-3">
          {gauges.map(([g, role]) => {
            const r = g.recession!;
            const notes = [
              r.tidal ? t("recession.tidal") : null,
              // Only where the tide reaches the gauge: above its reach the sea adds nothing.
              slowReturn(gate, r.tidal) ? t("recession.slowReturn") : null,
              r.lake ? t("recession.lake") : null,
              r.bankSuspect ? t("recession.bankSuspect") : null,
              r.censored > 0 ? t("recession.censored", { count: r.censored }) : null,
            ].filter(Boolean);
            return (
              <li
                key={g.code}
                className="flex flex-col gap-1 border-t border-jaga-line pt-2"
                data-recession-gauge={g.code}
              >
                <p className="font-bold">
                  {g.code} · {g.name.th ?? g.name.en ?? ""}{" "}
                  <span className={`${hint} font-normal`}>{t(`recession.role.${role}`)}</span>
                </p>
                <p className={hint}>
                  {t("recession.events", {
                    count: r.events,
                    overBank: r.overBank,
                    from: r.firstSeason ?? "",
                    to: r.lastSeason ?? "",
                  })}
                </p>
                {r.toBank ? (
                  <p data-recession="bank">
                    {t("recession.toBank", {
                      median: median(t, r.toBank.p50),
                      range: spanText(t, r.toBank.p25, r.toBank.p75),
                    })}
                  </p>
                ) : null}
                {r.toWarningOverBank ? (
                  <p data-recession="warning">
                    {t("recession.toWarning", {
                      median: median(t, r.toWarningOverBank.p50),
                      range: spanText(t, r.toWarningOverBank.p25, r.toWarningOverBank.p75),
                    })}
                  </p>
                ) : null}
                {!r.toBank && !r.toWarningOverBank ? (
                  <p className={hint}>{t("recession.tooFew")}</p>
                ) : null}
                {notes.length > 0 || !r.usable ? (
                  <p className={hint}>
                    {[...notes, !r.usable ? t("recession.notUsable") : null]
                      .filter(Boolean)
                      .join(" ")}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>
    </details>
  );
}

function GaugeLevelsBox({
  gauge,
  role,
  zone,
  locale,
  t,
  action,
}: {
  gauge: Gauge;
  role: "key" | "upstream" | "other";
  zone: Zone;
  locale: string;
  t: T;
  action?: (form: FormData) => void;
}) {
  const signal = role === "key" ? "key_level_m" : role === "upstream" ? "upstream_level_m" : null;
  const th = signal ? zone.thresholds.find((x) => x.signal === signal) : undefined;
  const value = (level: Level) =>
    (signal ? thresholdOf(zone, signal, level) : null) ?? gauge.levels?.[level] ?? null;
  const provisional = th ? th.provisional : (gauge.levels?.provisional ?? true);
  const stored = LEVELS.some((l) => value(l) !== null);
  return (
    <form
      action={action}
      className="flex flex-col gap-2 border-t border-jaga-line pt-3"
      data-gauge-levels-box={gauge.code}
    >
      <input type="hidden" name="station" value={gauge.id ?? ""} />
      <input type="hidden" name="zone" value={zone.id} />
      <p className="font-bold">
        {t(`thresholds.role.${role}`, { code: gauge.code, name: localName(gauge.name, locale) })}{" "}
        <span className={`${hint} font-normal`}>
          {!stored
            ? t("thresholds.unset")
            : provisional
              ? t("thresholds.suggested")
              : t("thresholds.byHand", {
                  time: th?.updatedAt ? when(locale, th.updatedAt) : "",
                })}
        </span>
      </p>
      {gauge.levels?.bankSuspect ? (
        <p className={`${hint} font-bold`}>{t("thresholds.bankSuspect")}</p>
      ) : null}
      <div className="grid grid-cols-3 gap-2">
        {LEVELS.map((level) => (
          <label key={level} className="flex flex-col gap-1">
            <span className={label}>{t(`level.${level}`)}</span>
            <input
              className={input}
              name={level}
              inputMode="decimal"
              defaultValue={value(level) === null ? "" : fix(value(level)!)}
              data-level={level}
            />
          </label>
        ))}
      </div>
      {action && gauge.id ? (
        <button type="submit" className={`${buttonPrimary} self-start`}>
          {t("thresholds.saveGauge")}
        </button>
      ) : null}
    </form>
  );
}

function AutoTick({ gauge, t, action }: { gauge: Gauge; t: T; action?: (form: FormData) => void }) {
  return (
    <form
      action={action}
      className="flex flex-wrap items-center gap-3 rounded-xl border border-jaga-line p-2"
      data-signal-auto={gauge.code}
    >
      <input type="hidden" name="station" value={gauge.id} />
      <label className="flex min-h-tap items-center gap-2">
        <input type="checkbox" name="enabled" defaultChecked={gauge.auto} className="h-6 w-6" />
        <span className="font-medium">{t("auto.gauge")}</span>
      </label>
      {action ? (
        <button type="submit" className={`${buttonSecondary} w-auto px-4`}>
          {t("auto.save")}
        </button>
      ) : null}
    </form>
  );
}

function AutoPanel({
  data,
  locale,
  t,
  allAction,
  modeAction,
  dismissAction,
}: {
  data: Signals;
  locale: string;
  t: T;
  allAction?: (form: FormData) => void;
  modeAction?: (form: FormData) => void;
  dismissAction?: (form: FormData) => void;
}) {
  const auto = data.auto ?? { graceMinutes: 20, maxAgeH: 3, mode: "drill" as const };
  const inZones = (data.allGauges ?? []).filter((g) => g.zoneId);
  const on = inZones.filter((g) => g.auto).length;
  const events = data.events ?? [];
  const pending = events.filter((e) => e.status === "pending");
  const zoneName = (id: string) =>
    localName(data.zones.find((z) => z.id === id)?.name ?? {}, locale);
  const draftHref = (e: AutoEvent) => ({
    pathname: "/admin/alerts/new" as const,
    query: {
      zone: e.zoneId,
      level: e.level,
      note: `${e.gauge ?? ""} ${fix(e.value)} m (${fix(e.threshold)} m)`,
    },
  });
  return (
    <section className={`${card} border-2 border-jaga-edge`} data-signals-auto={auto.mode}>
      <h2 className="text-h3 font-bold text-jaga-ink">{t("auto.title")}</h2>
      <p>{t("auto.rule", { age: auto.maxAgeH, grace: auto.graceMinutes })}</p>
      <p className="font-bold" data-signals-auto-mode>
        {auto.mode === "real" ? t("auto.modeReal") : t("auto.modeDrill")}
      </p>
      <p className={hint}>{t("auto.count", { on, all: inZones.length })}</p>
      {allAction || modeAction ? (
        <div className="flex flex-wrap gap-2">
          {allAction ? (
            <>
              <form action={allAction}>
                <input type="hidden" name="station" value="all" />
                <input type="hidden" name="enabled" value="on" />
                <button
                  type="submit"
                  className={`${buttonPrimary} w-auto px-4`}
                  data-signals-all-on
                >
                  {t("auto.allOn")}
                </button>
              </form>
              <form action={allAction}>
                <input type="hidden" name="station" value="all" />
                <button
                  type="submit"
                  className={`${buttonSecondary} w-auto px-4`}
                  data-signals-all-off
                >
                  {t("auto.allOff")}
                </button>
              </form>
            </>
          ) : null}
          {modeAction ? (
            <form action={modeAction}>
              <input type="hidden" name="mode" value={auto.mode === "real" ? "drill" : "real"} />
              <button type="submit" className={`${buttonSecondary} w-auto px-4`}>
                {auto.mode === "real" ? t("auto.toDrill") : t("auto.toReal")}
              </button>
            </form>
          ) : null}
        </div>
      ) : null}
      {pending.length > 0 && (
        <div className="flex flex-col gap-2" data-signals-pending={pending.length}>
          <h3 className="font-bold text-jaga-ink">{t("auto.pending")}</h3>
          {pending.map((e) => (
            <div
              key={e.id}
              className="flex flex-col gap-2 rounded-xl border-2 border-jaga-edge p-3"
            >
              <p>
                {t("auto.pendingLine", {
                  level: t(`level.${e.level}`),
                  zone: zoneName(e.zoneId),
                  gauge: e.gauge ?? "",
                  value: fix(e.value),
                  threshold: fix(e.threshold),
                  time: e.deadline ? when(locale, e.deadline) : "",
                })}
              </p>
              <div className="flex flex-wrap gap-2">
                <Link href={draftHref(e)} className={`${buttonPrimary} w-auto px-4`}>
                  {t("auto.openDraft")}
                </Link>
                {dismissAction ? (
                  <form action={dismissAction} className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="event" value={e.id} />
                    <label className="flex flex-col gap-1">
                      <span className={hint}>{t("auto.dismissNote")}</span>
                      <input name="note" maxLength={300} className={input} />
                    </label>
                    <button type="submit" className={`${buttonSecondary} w-auto px-4`}>
                      {t("auto.dismiss")}
                    </button>
                  </form>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
      {events.some((e) => e.status !== "pending") && (
        <details>
          <summary className="min-h-tap cursor-pointer font-bold text-jaga-ink">
            {t("auto.recent")}
          </summary>
          <ul className="list-disc ps-5">
            {events
              .filter((e) => e.status !== "pending")
              .map((e) => (
                <li key={e.id}>
                  {e.createdAt ? when(locale, e.createdAt) : ""} · {t(`level.${e.level}`)} ·{" "}
                  {zoneName(e.zoneId)} · {e.gauge} {fix(e.value)} m · {t(`auto.status.${e.status}`)}
                </li>
              ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/** The map view's marks, built on the server from the same read as the cards. */
function mapPoints(data: Signals, locale: string): MapPoint[] {
  return (data.allGauges ?? []).map((g) => {
    const levels = mapLevels(g, data.zones);
    const st = gaugeNow(g, data.now);
    return {
      id: g.id ?? null,
      code: g.code,
      name: localName(g.name, locale),
      agency: g.agency,
      zone: g.zoneId
        ? localName(data.zones.find((z) => z.id === g.zoneId)?.name ?? {}, locale)
        : null,
      lon: g.lon,
      lat: g.lat,
      state: gaugeState(g, data.now, levels),
      value: st ? st.value : null,
      at: st ? when(locale, st.at) : null,
      ageH: st ? st.ageH : null,
      rise: st ? st.riseM : null,
      bank: g.bank,
      warning: levels.warning ?? null,
      levels: {
        watch: levels.watch ?? null,
        warning: levels.warning ?? null,
        evacuate: levels.evacuate ?? null,
        provisional: g.levels?.provisional ?? true,
        how: g.levels?.how ?? null,
        floods: g.levels?.floods ?? null,
        bankSuspect: g.levels?.bankSuspect ?? false,
        neverReachedBank: g.levels?.neverReachedBank ?? false,
        isKey: keyLevelsFor(g, data.zones) !== undefined,
      },
      auto: g.auto === true,
      canAuto: g.zoneId !== null,
      series: g.series,
    };
  });
}

export function SignalsView({
  data,
  gates = [],
  locale,
  t,
  action,
  notice,
  savedZone,
  view = "cards",
  autoAction,
  allAction,
  modeAction,
  dismissAction,
  levelsAction,
  reservoirs,
  refreshMinutes,
}: {
  data: Signals;
  /** One row per river mouth (`coastal_gate_reference`); empty until the migration is applied. */
  gates?: GateReference[];
  locale: string;
  t: T;
  action?: (form: FormData) => void;
  notice?: string | null;
  savedZone?: string | null;
  view?: "cards" | "map";
  autoAction?: (form: FormData) => void;
  allAction?: (form: FormData) => void;
  modeAction?: (form: FormData) => void;
  dismissAction?: (form: FormData) => void;
  levelsAction?: (form: FormData) => void;
  /**
   * The reservoirs' own panel (components/admin/ReservoirLevels.tsx), passed in rather than read
   * here so this view stays the pure thing the dev examples render: the page that fetches builds
   * it. Under the gauges, because a reservoir is read after the river it feeds.
   */
  reservoirs?: ReactNode;
  /** Read the page again this often while it is open (the live page; never the example). */
  refreshMinutes?: number;
}) {
  return (
    <div className="flex flex-col gap-5" data-signals={data.zones.length} data-signals-view={view}>
      <h1 className="text-h3 font-bold text-jaga-ink">{t("title")}</h1>
      <p className={hint}>{t("intro")}</p>
      <nav aria-label={t("view.label")} className="flex gap-2">
        {(["cards", "map"] as const).map((v) => (
          <Link
            key={v}
            href={{ pathname: "/admin/signals", query: v === "map" ? { view: "map" } : {} }}
            aria-current={view === v ? "page" : undefined}
            className={`${view === v ? buttonPrimary : buttonSecondary} w-auto px-4`}
            data-signals-switch={v}
          >
            {t(`view.${v}`)}
          </Link>
        ))}
      </nav>
      {notice ? (
        <p
          role="status"
          className="rounded-xl border-2 border-jaga-edge p-3 font-bold"
          data-signals-notice
        >
          {notice}
        </p>
      ) : null}
      <section className={card} data-signal-feeds>
        <h2 className="font-bold text-jaga-ink">{t("feed.title")}</h2>
        <ul className="list-disc ps-5">
          <FeedLine
            name={t("feed.gauges")}
            feed={data.feeds.gauges}
            now={data.now}
            locale={locale}
            t={t}
          />
          <FeedLine
            name={t("feed.forecasts")}
            feed={data.feeds.signals}
            now={data.now}
            locale={locale}
            t={t}
          />
        </ul>
        <p className={hint}>{t("feed.lag")}</p>
        {refreshMinutes ? (
          <p className={hint} data-signals-refresh={refreshMinutes}>
            {t("feed.refresh", { minutes: refreshMinutes })}
          </p>
        ) : null}
        {refreshMinutes ? <RefreshEvery minutes={refreshMinutes} /> : null}
      </section>
      <AutoPanel
        data={data}
        locale={locale}
        t={t}
        allAction={allAction}
        modeAction={modeAction}
        dismissAction={dismissAction}
      />
      {view === "map" ? (
        <SignalsMap
          points={mapPoints(data, locale)}
          zones={{
            type: "FeatureCollection",
            features: data.zones
              .filter((z) => z.outline)
              .map((z) => ({
                type: "Feature",
                geometry: z.outline!,
                properties: { name: localName(z.name, locale) },
              })),
          }}
          action={autoAction}
          levelsAction={levelsAction}
          words={{
            title: t("map.title"),
            hint: t("map.hint"),
            states: {
              evacuate: t("map.state.evacuate"),
              warning: t("map.state.warning"),
              near: t("map.state.near"),
              normal: t("map.state.normal"),
              stale: t("map.state.stale"),
              nolevels: t("map.state.nolevels"),
            },
            close: t("map.close"),
            zone: t("map.zone", { zone: "{zone}" }),
            noZone: t("map.noZone"),
            autoOn: t("map.auto"),
            autoLabel: t("auto.gauge"),
            autoHint: t("auto.gaugeHint"),
            save: t("auto.save"),
            level: t("gauge.level"),
            measured: t("gauge.measured"),
            rise: t("gauge.rise"),
            bank: t("gauge.toBank"),
            warning: t("level.warning"),
            unknown: t("unknown"),
            notIssued: t("suggestion.onlyAdvice"),
            levels: {
              title: t("map.levels.title"),
              none: t("map.levels.none"),
              watch: t("level.watch"),
              warning: t("level.warning"),
              evacuate: t("level.evacuate"),
              provisional: t("map.levels.provisional"),
              set: t("map.levels.set"),
              fromFloods: t("map.levels.fromFloods"),
              fromRise: t("map.levels.fromRise"),
              key: t("map.levels.key"),
              bankSuspect: t("map.levels.bankSuspect"),
              neverReached: t("map.levels.neverReached"),
              note: t("map.levels.note"),
              save: t("map.levels.save"),
              hint: t("map.levels.hint"),
            },
          }}
        />
      ) : null}
      {view === "map" ? null : data.zones.length === 0 ? <p>{t("noZones")}</p> : null}
      {(view === "map" ? [] : data.zones).map((zone) => (
        <ZoneCard
          key={zone.id}
          zone={zone}
          gate={gateFor(gates, zone, data.now)}
          now={data.now}
          locale={locale}
          t={t}
          action={action}
          autoAction={autoAction}
          levelsAction={levelsAction}
          saved={savedZone === zone.id}
        />
      ))}
      {view === "map" ? null : <MouthsWithoutZone gates={gates} locale={locale} t={t} />}
      {view === "map" ? null : reservoirs}
    </div>
  );
}

/** The gate for one zone, when a reference for its mouth exists. */
function gateFor(gates: GateReference[], zone: Zone, now: number): Gate | null {
  const reference = gates.find((g) => g.basin === zone.basin);
  return reference ? coastalGate(zone.tide, reference, now) : null;
}

/**
 * Mouths with a reference and no warning zone, so no live forecast is stored for them. Today that
 * is the Bang Nara: no zone covers Mueang Narathiwat, which is the gap the owner's question of
 * 16 Oct 2026 turned up. Named here so it is not quietly missing from the dashboard.
 */
function MouthsWithoutZone({
  gates,
  locale,
  t,
}: {
  gates: GateReference[];
  locale: string;
  t: T;
}) {
  const orphans = gates.filter((g) => g.basin === null);
  if (orphans.length === 0) return null;
  return (
    <section className={card} data-signal-gate-nozone>
      <h2 className="font-bold text-jaga-ink">{t("gate.noZoneTitle")}</h2>
      <ul className="list-disc ps-5">
        {orphans.map((g) => (
          <li key={g.id} className={hint}>
            {t("gate.noZone", { name: localName(g.name, locale) })}
          </li>
        ))}
      </ul>
    </section>
  );
}
