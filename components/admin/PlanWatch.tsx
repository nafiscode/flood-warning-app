import { getTranslations } from "next-intl/server";
import { DualTime } from "@/components/admin/DualTime";
import { CheckIcon, ClockIcon, TriangleIcon } from "@/components/icons";
import { addReading, deleteReading } from "@/app/[locale]/admin/plans/actions";
import { bytesText, ioPerDay, type PlanHealth, type StoredReading } from "@/lib/admin-plans";
import {
  FLOOD_MARGIN,
  formatAmount,
  METERS,
  UPGRADE_MARKS,
  type Advice,
  type DateSpan,
  type MeterEstimate,
  type PlanService,
} from "@/lib/plan-limits";
import { buttonPrimary, card, errorNotice, hint, input, label, notice } from "@/lib/ui";

type T = (key: string, values?: Record<string, string | number>) => string;

const LINKS: Record<PlanService, string> = {
  vercel: "https://vercel.com/dashboard",
  supabase: "https://supabase.com/dashboard",
};

/** "27 Nov", in the reader's language, from a plain date. */
function dayText(ymd: string, locale: string): string {
  const tag = locale === "th" ? "th-TH" : locale === "ms" ? "ms-MY" : "en-GB";
  return new Intl.DateTimeFormat(tag, { day: "numeric", month: "short", timeZone: "UTC" }).format(
    new Date(`${ymd}T00:00:00Z`),
  );
}

function spanLine(
  t: T,
  locale: string,
  span: DateSpan,
  keys: { between: string; on: string },
  values: Record<string, string> = {},
): string {
  const from = dayText(span.soonest, locale);
  const to = dayText(span.latest, locale);
  return from === to ? t(keys.on, { from, ...values }) : t(keys.between, { from, to, ...values });
}

const percent = (share: number) => Math.round(share * 100);

/** The three verdicts, each with its own picture and its own words: never by colour alone. */
const VERDICT_ICON = {
  now: TriangleIcon,
  soon: ClockIcon,
  later: CheckIcon,
  done: CheckIcon,
} as const;

function Bar({ share, trigger, text }: { share: number; trigger: number; text: string }) {
  const used = Math.min(100, Math.max(0, share * 100));
  return (
    <div
      role="img"
      aria-label={text}
      className="relative h-3 w-full overflow-hidden rounded-full bg-jaga-line"
    >
      <div className="h-full rounded-full bg-jaga-slate" style={{ width: `${used}%` }} />
      <div
        className="absolute inset-y-0 w-0.5 bg-jaga-ink"
        style={{ insetInlineStart: `${trigger * 100}%` }}
      />
    </div>
  );
}

function MeterRow({ m, t, locale }: { m: MeterEstimate; t: T; locale: string }) {
  const { def, latest } = m;
  const name = t(`meter.${def.id}.name`);
  const fmt = (v: number) => formatAmount(def.unit, v);
  return (
    <li
      className="flex flex-col gap-1.5 border-t border-jaga-line pt-3 first:border-0 first:pt-0"
      data-meter={def.id}
      data-status={m.status}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <p className="font-bold text-jaga-ink">{name}</p>
        <p className="font-medium" data-meter-status={m.status}>
          {t(`status.${m.status}`)}
        </p>
      </div>
      {!latest && <p className={hint}>{t("noReading")}</p>}
      {latest && def.kind === "flag" && <p>{m.status === "act" ? t("flagOn") : t("flagOff")}</p>}
      {latest && m.share !== null && (
        <>
          <p>
            {t("ofLimit", { value: fmt(latest.value), limit: fmt(def.limit) })} ·{" "}
            {t("share", { percent: percent(m.share) })}
          </p>
          <Bar
            share={m.share}
            trigger={def.trigger}
            text={`${name}: ${t("share", { percent: percent(m.share) })}. ${t("line", { value: fmt(def.limit * def.trigger) })}`}
          />
          <p className={hint}>{t("line", { value: fmt(def.limit * def.trigger) })}</p>
          {m.perDay && (
            <p className={hint}>
              {t("pace", { low: fmt(m.perDay.low), high: fmt(m.perDay.high) })}
            </p>
          )}
          {m.endShare && latest.resetsOn && (
            <p className={hint}>
              {t("endShare", {
                date: dayText(latest.resetsOn, locale),
                low: percent(m.endShare.low),
                high: percent(m.endShare.high),
              })}
            </p>
          )}
          {m.limitOn && m.share < 1 && (
            <p className={hint}>
              {spanLine(t, locale, m.limitOn, { between: "limitReached", on: "limitReached" })}
            </p>
          )}
        </>
      )}
      {latest && (
        <p className={hint}>
          {t("readAt", { when: "" }).trimEnd()} <DualTime iso={latest.at} />
          {m.stale && m.ageDays !== null && (
            <> · {t("staleReading", { days: Math.floor(m.ageDays) })}</>
          )}
        </p>
      )}
      <p className={hint}>{t(`meter.${def.id}.where`)}</p>
    </li>
  );
}

function ServiceCard({
  advice,
  t,
  locale,
  now,
}: {
  advice: Advice;
  t: T;
  locale: string;
  now: Date;
}) {
  const s = advice.service;
  const service = t(`service.${s}.name`);
  const Icon = VERDICT_ICON[advice.verdict];
  const today = now.toISOString().slice(0, 10);
  const done = advice.verdict === "done";
  const showDue = !done && advice.upgradeBy && advice.upgradeBy.soonest > today;
  // A cycle meter with one reading and no reset date cannot be given a pace.
  const needsReset = advice.meters.some(
    (m) =>
      m.def.kind === "cycle" && m.latest && !m.latest.resetsOn && !m.perDay && (m.share ?? 0) < 1,
  );
  return (
    <section
      className={`${card} ${advice.verdict === "now" ? "border-2 border-jaga-edge" : ""}`}
      data-service={s}
      data-verdict={advice.verdict}
      aria-labelledby={`plan-${s}`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 id={`plan-${s}`} className="text-h3 font-bold text-jaga-ink">
          {service} · {t(`service.${s}.plan`)}
        </h2>
        <p className={hint}>{t(`service.${s}.role`)}</p>
      </div>
      <p className="flex items-center gap-2 text-h3 font-bold text-jaga-ink" data-verdict-text>
        <Icon size={28} />
        {t(`verdict.${advice.verdict}`)}
      </p>
      <p>
        {t(`verdictBody.${advice.verdict}`, {
          service,
          date: advice.upgradedOn ? dayText(advice.upgradedOn, locale) : "",
        })}
      </p>
      {advice.blind && !done && <p className={notice}>{t("blind", { service })}</p>}
      {showDue && advice.upgradeBy && (
        <p className="font-medium" data-upgrade-by>
          {advice.upgradeBy.nextCycle
            ? t("dueNext", { from: dayText(advice.upgradeBy.soonest, locale) })
            : spanLine(t, locale, advice.upgradeBy, { between: "dueBetween", on: "dueOn" })}
        </p>
      )}
      {!advice.upgradeBy &&
        !advice.blind &&
        (advice.verdict === "soon" || advice.verdict === "later") && <p>{t("dueNone")}</p>}
      {!done &&
        advice.pausesOn &&
        advice.pausesOn.soonest >= today &&
        !advice.pausesOn.nextCycle && (
          <p data-pauses-on>
            {spanLine(
              t,
              locale,
              advice.pausesOn,
              { between: "pausesBetween", on: "pausesOn" },
              { service },
            )}
          </p>
        )}
      {!done && needsReset && <p className={hint}>{t("needsReset", { service })}</p>}
      {!done && advice.floodSeason && (
        <p className={hint}>{t("seasonMargin", { margin: FLOOD_MARGIN })}</p>
      )}

      <ul className="flex flex-col gap-3">
        {advice.meters.map((m) => (
          <MeterRow key={m.def.id} m={m} t={t} locale={locale} />
        ))}
      </ul>

      {s === "supabase" &&
        advice.meters.some((m) => m.def.id === "disk_io" && m.status === "act") && (
          <div className={notice}>
            <p className="font-bold text-jaga-ink">{t("diskIo.title")}</p>
            <p>{t("diskIo.body")}</p>
          </div>
        )}
      <p className={hint}>{t(`service.${s}.upgrade`)}</p>
      <a
        href={LINKS[s]}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-tap items-center font-medium text-jaga-ink underline"
      >
        {t(`service.${s}.open`)}
      </a>
    </section>
  );
}

function Health({
  health,
  readings,
  t,
  locale,
}: {
  health: PlanHealth | null;
  readings: StoredReading[];
  t: T;
  locale: string;
}) {
  if (!health) {
    return (
      <section className={card} data-health="missing">
        <h2 className="text-h3 font-bold text-jaga-ink">{t("health.title")}</h2>
        <p className={notice}>{t("health.missing")}</p>
      </section>
    );
  }
  const readPerDay = ioPerDay(readings, "io_read_gb");
  const writePerDay = ioPerDay(readings, "io_write_gb");
  const gb = (v: number) => formatAmount("gb", v);
  return (
    <section className={card} data-health="ok">
      <h2 className="text-h3 font-bold text-jaga-ink">{t("health.title")}</h2>
      <p className={hint}>
        {t("health.intro", {
          since: health.statsReset
            ? new Intl.DateTimeFormat(
                locale === "th" ? "th-TH" : locale === "ms" ? "ms-MY" : "en-GB",
                {
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                  hourCycle: "h23",
                  timeZone: "Asia/Bangkok",
                },
              ).format(new Date(health.statsReset))
            : "?",
        })}
      </p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
        <div className="col-span-2 sm:col-span-3">
          <dt className="font-medium">{t("health.size")}</dt>
          <dd>{t("health.sizeOf", { size: bytesText(health.dbBytes, locale) })}</dd>
        </div>
        <div>
          <dt className="font-medium">{t("health.storage")}</dt>
          <dd>{bytesText(health.storageBytes, locale)}</dd>
        </div>
        <div>
          <dt className="font-medium">{t("health.users")}</dt>
          <dd>{health.authUsers.toLocaleString("en-GB")}</dd>
        </div>
        <div>
          <dt className="font-medium">{t("health.connections")}</dt>
          <dd>{health.connections}</dd>
        </div>
        {health.cacheHit !== null && (
          <div className="col-span-2 sm:col-span-3">
            <dt className="font-medium">{t("health.cache")}</dt>
            <dd>
              {(health.cacheHit * 100).toFixed(2)}%{" "}
              <span className={hint}>{t("health.cacheHint")}</span>
            </dd>
          </div>
        )}
      </dl>

      <p className="font-medium" data-io>
        {readPerDay !== null && writePerDay !== null
          ? t("health.io", { read: gb(readPerDay), write: gb(writePerDay) })
          : t("health.ioNone")}
      </p>

      <div className="flex flex-col gap-2" data-writers>
        <h3 className="font-bold text-jaga-ink">{t("health.writers")}</h3>
        <p className={hint}>{t("health.writersHint")}</p>
        <ul className="flex flex-col gap-2">
          {health.writers.map((w) => (
            <li
              key={w.table}
              className="flex flex-wrap justify-between gap-x-3 border-t border-jaga-line pt-2 first:border-0 first:pt-0"
            >
              <span className="break-all font-mono">{w.table}</span>
              <span className="tabular-nums">
                {t("health.writes")} {w.writes.toLocaleString("en-GB")} · {t("health.dead")}{" "}
                {w.dead.toLocaleString("en-GB")} · {bytesText(w.bytes, locale)}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-col gap-2" data-crons>
        <h3 className="font-bold text-jaga-ink">{t("health.crons")}</h3>
        <ul className="flex flex-col gap-2">
          {health.crons.map((c) => (
            <li
              key={c.name}
              className="flex flex-wrap justify-between gap-x-3 border-t border-jaga-line pt-2 first:border-0 first:pt-0"
            >
              <span className="break-all font-mono">
                {c.name} <span className={hint}>{c.schedule}</span>
              </span>
              <span className="tabular-nums">
                {c.runs.toLocaleString("en-GB")}
                {c.failed > 0 && <> · {t("health.failed", { count: c.failed })}</>}
                {!c.active && <> · {t("health.off")}</>}
              </span>
            </li>
          ))}
        </ul>
        <p className="font-medium">
          {t("health.cronLog", {
            rows: health.cronLog.rows.toLocaleString("en-GB"),
            size: bytesText(health.cronLog.bytes, locale),
          })}
        </p>
        <p className={hint}>{t("health.cronLogHint")}</p>
      </div>
    </section>
  );
}

export async function PlanWatch({
  locale,
  advice,
  readings,
  health,
  notices,
  now,
}: {
  locale: string;
  advice: Advice[];
  readings: StoredReading[];
  health: PlanHealth | null;
  notices: { saved: boolean; removed: boolean; error: string | null };
  now: Date;
}) {
  const tr = await getTranslations({ locale, namespace: "plans" });
  const t: T = (key, values) => tr(key as never, values as never);
  const hand = readings
    .filter((r) => !r.auto)
    .slice(-25)
    .reverse();
  const autoCount = readings.length - readings.filter((r) => !r.auto).length;
  const meterOptions = [...METERS, ...UPGRADE_MARKS].map((m) => ({ id: m.id, service: m.service }));
  const order = { now: 0, soon: 1, later: 2, done: 3 } as const;
  const sorted = [...advice].sort((a, b) => order[a.verdict] - order[b.verdict]);
  return (
    <div className="flex flex-col gap-5" data-plans>
      <h1 className="text-h3 font-bold text-jaga-ink">{t("title")}</h1>
      <p>{t("intro")}</p>
      <p className={hint}>{t("source")}</p>
      <p className={hint}>{t("pushNote")}</p>
      {notices.saved && <p className={notice}>{t("saved")}</p>}
      {notices.removed && <p className={notice}>{t("removed")}</p>}
      {notices.error && (
        <p className={errorNotice} role="alert">
          {t(`error.${notices.error}`)}
        </p>
      )}

      {sorted.map((a) => (
        <ServiceCard key={a.service} advice={a} t={t} locale={locale} now={now} />
      ))}

      <Health health={health} readings={readings} t={t} locale={locale} />

      <form id="add" action={addReading.bind(null, locale)} className={card}>
        <h2 className="text-h3 font-bold text-jaga-ink">{t("add.title")}</h2>
        <div className="flex flex-col gap-1">
          <label htmlFor="plan-meter" className={label}>
            {t("add.meter")}
          </label>
          <select id="plan-meter" name="meter" className={input} required>
            {meterOptions.map((m) => (
              <option key={m.id} value={m.id}>
                {t(`service.${m.service}.name`)} · {t(`meter.${m.id}.name`)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="plan-value" className={label}>
            {t("add.value")}
          </label>
          <input
            id="plan-value"
            name="value"
            type="text"
            inputMode="text"
            required
            autoComplete="off"
            className={input}
          />
          <p className={hint}>{t("add.valueHint")}</p>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="plan-resets" className={label}>
            {t("add.resets")}
          </label>
          <input id="plan-resets" name="resets_on" type="date" className={input} />
          <p className={hint}>{t("add.resetsHint")}</p>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="plan-note" className={label}>
            {t("add.note")}
          </label>
          <input id="plan-note" name="note" type="text" maxLength={200} className={input} />
        </div>
        <button type="submit" className={buttonPrimary}>
          {t("add.save")}
        </button>
      </form>

      <section id="history" className={card} data-history={hand.length}>
        <h2 className="text-h3 font-bold text-jaga-ink">{t("history.title")}</h2>
        {hand.length === 0 && <p>{t("history.none")}</p>}
        <ul className="flex flex-col gap-3">
          {hand.map((r) => {
            const def = METERS.find((m) => m.id === r.meter);
            const name = def ? t(`meter.${def.id}.name`) : r.meter;
            return (
              <li
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-2 border-t border-jaga-line pt-3 first:border-0 first:pt-0"
              >
                <div>
                  <p className="font-medium">
                    {t(`service.${r.service}.name`)} · {name}:{" "}
                    {def
                      ? def.kind === "flag"
                        ? r.value > 0
                          ? t("yes")
                          : t("no")
                        : formatAmount(def.unit, r.value)
                      : r.value}
                  </p>
                  <p className={hint}>
                    <DualTime iso={r.at} />
                    {r.resetsOn ? ` · ${dayText(r.resetsOn, locale)}` : ""}
                    {r.note ? ` · ${r.note}` : ""}
                  </p>
                </div>
                {r.byMe && (
                  <form action={deleteReading.bind(null, locale)}>
                    <input type="hidden" name="id" value={r.id} />
                    <button
                      type="submit"
                      className="min-h-tap rounded-xl border-2 border-jaga-edge px-4 py-2 font-medium text-jaga-ink"
                      aria-label={t("history.removeLabel", {
                        meter: name,
                        when: r.at.slice(0, 10),
                      })}
                    >
                      {t("history.remove")}
                    </button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
        {autoCount > 0 && <p className={hint}>{t("history.auto", { count: autoCount })}</p>}
      </section>
    </div>
  );
}
