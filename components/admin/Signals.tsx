import type { ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import {
  FORECAST_STALE_H,
  gaugeNow,
  LEVELS,
  linePath,
  rainNow,
  SIGNAL_KEYS,
  span,
  suggest,
  thresholdOf,
  type Feed,
  type Gauge,
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
}: {
  gauge: Gauge;
  role: "key" | "upstream";
  zone: Zone;
  now: number;
  locale: string;
  t: T;
}) {
  const state = gaugeNow(gauge, now);
  const refs: Ref[] = [];
  if (gauge.bank !== null)
    refs.push({ value: gauge.bank, text: t("ref.bank", { value: fix(gauge.bank) }) });
  const warning = role === "key" ? thresholdOf(zone, "key_level_m", "warning") : null;
  if (warning !== null && warning !== gauge.bank)
    refs.push({ value: warning, text: t("ref.warning", { value: fix(warning) }) });
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

function ZoneCard({
  zone,
  now,
  locale,
  t,
  action,
  saved,
}: {
  zone: Zone;
  now: number;
  locale: string;
  t: T;
  action?: (form: FormData) => void;
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
          <Link href="/admin/alerts/new" className={`${buttonSecondary} self-start`}>
            {t("suggestion.toAlerts")}
          </Link>
        </div>
      </header>

      {zone.key ? (
        <GaugeBlock gauge={zone.key} role="key" zone={zone} now={now} locale={locale} t={t} />
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
        </section>
      </div>
      {zone.forecastIssuedAt ? (
        <p className={hint}>{t("forecastAt", { time: when(locale, zone.forecastIssuedAt) })}</p>
      ) : null}

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
          {SIGNAL_KEYS.map((signal) => {
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
                  {LEVELS.map((level) => (
                    <label key={level} className="flex flex-col gap-1">
                      <span className={label}>{t(`level.${level}`)}</span>
                      <input
                        className={input}
                        name={level}
                        inputMode="decimal"
                        defaultValue={th?.levels[level] ?? ""}
                      />
                    </label>
                  ))}
                </div>
                {action ? (
                  <button type="submit" className={`${buttonPrimary} self-start`}>
                    {t("thresholds.save")}
                  </button>
                ) : null}
              </form>
            );
          })}
        </div>
      </details>
    </article>
  );
}

export function SignalsView({
  data,
  locale,
  t,
  action,
  notice,
  savedZone,
}: {
  data: Signals;
  locale: string;
  t: T;
  action?: (form: FormData) => void;
  notice?: string | null;
  savedZone?: string | null;
}) {
  return (
    <div className="flex flex-col gap-5" data-signals={data.zones.length}>
      <h1 className="text-h3 font-bold text-jaga-ink">{t("title")}</h1>
      <p className={hint}>{t("intro")}</p>
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
      </section>
      {data.zones.length === 0 ? <p>{t("noZones")}</p> : null}
      {data.zones.map((zone) => (
        <ZoneCard
          key={zone.id}
          zone={zone}
          now={data.now}
          locale={locale}
          t={t}
          action={action}
          saved={savedZone === zone.id}
        />
      ))}
    </div>
  );
}
