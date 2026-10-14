"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { DualTime } from "@/components/admin/DualTime";
import {
  consolePanel,
  CountUp,
  lift,
  now as nowClass,
  Ring,
  rise,
} from "@/components/admin/ImpactBits";
import { Link } from "@/i18n/navigation";
import { card, hint, notice } from "@/lib/ui";
import {
  funnel,
  insights,
  minutesAndSeconds,
  secondsText,
  share,
  stickiness,
  alertLift,
  USAGE_WINDOWS,
  type UsageData,
  type UsageWindow,
} from "@/lib/usage";
import {
  BarList,
  DayBars,
  Funnel,
  Rhythm,
  Seen,
  SpeedBar,
  Tile,
  TimeLine,
  usageMotion as motion,
} from "./UsageBits";
import type { UsageLayer, UsageView } from "./UsageMap";

// MapLibre is only fetched when the map is scrolled near (slow connections, small phones).
const UsageMap = dynamic(() => import("./UsageMap").then((m) => m.UsageMap), { ssr: false });

/** How often the page asks again while it is open. */
export const REFRESH_MS = 30_000;

/** Insight cards shown before the "show more" fold: a phone screen holds about three. */
const FIRST_INSIGHTS = 3;

/**
 * The usage dashboard (the owner, 14 Oct): who has Jaga open now, on what, from where, and how
 * much it is used, for the admins and the developer. Counts only, never one phone (see the
 * migration a13_usage_log). `example` is for /dev/usage: made-up figures, nothing is fetched.
 */
export function Usage({
  initial,
  days,
  locale,
  example = false,
}: {
  initial: UsageData | null;
  days: UsageWindow;
  locale: string;
  example?: boolean;
}) {
  const t = useTranslations("usage");
  const tl = useTranslations("alert.level");
  const [data, setData] = useState<UsageData | null>(initial);
  const [failed, setFailed] = useState(false);
  const [paused, setPaused] = useState(false);
  const [layer, setLayer] = useState<UsageLayer>("areas");
  const [view, setView] = useState<UsageView>("area");
  const [showLive, setShowLive] = useState(true);
  const [mapNear, setMapNear] = useState(false);
  const mapBox = useRef<HTMLDivElement>(null);

  const nf = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const format = useCallback((n: number) => nf.format(n), [nf]);
  const name = useCallback(
    (x: { nameTh: string; nameEn: string }) => (locale === "th" ? x.nameTh : x.nameEn || x.nameTh),
    [locale],
  );

  const refresh = useCallback(async () => {
    if (example) return;
    try {
      const res = await fetch(`/api/admin/usage?days=${days}`, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      setData((await res.json()) as UsageData);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [days, example]);

  useEffect(() => {
    if (example || paused) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, REFRESH_MS);
    return () => window.clearInterval(id);
  }, [example, paused, refresh]);

  useEffect(() => {
    const node = mapBox.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setMapNear(true);
      return;
    }
    const watcher = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setMapNear(true);
          watcher.disconnect();
        }
      },
      { rootMargin: "400px" },
    );
    watcher.observe(node);
    return () => watcher.disconnect();
  }, []);

  if (!data) {
    return <p className={notice}>{t("failed")}</p>;
  }

  const d = data;
  const steps = funnel(d.totals);
  const notes = insights(d);
  const lifts = alertLift(d.hours, d.alerts);
  const visit = minutesAndSeconds(d.engagement.medianSeconds);
  const sticky = stickiness(d.engagement.dau, d.engagement.mau);
  const level = (k: string) => {
    try {
      return tl(k as never);
    } catch {
      return k;
    }
  };
  const mixName = (group: string) => (k: string) =>
    k === "__rest"
      ? t("mix.rest")
      : t.has(`mix.names.${group}.${k}` as never)
        ? t(`mix.names.${group}.${k}` as never)
        : k;
  const countryName = (k: string) => {
    if (k === "none" || k === "__rest") return k === "none" ? t("mix.unknownPlace") : t("mix.rest");
    try {
      return new Intl.DisplayNames([locale], { type: "region" }).of(k) ?? k;
    } catch {
      return k;
    }
  };
  const screenName = (k: string) =>
    k === "__rest"
      ? t("mix.rest")
      : t.has(`screens.names.${k.replace(/[/:]/g, "_")}` as never)
        ? t(`screens.names.${k.replace(/[/:]/g, "_")}` as never)
        : k;
  const sinceText = d.totals.since
    ? new Intl.DateTimeFormat(locale, {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(`${d.totals.since}T00:00:00Z`))
    : null;

  const insightCard = (n: (typeof notes)[number], i: number) => (
    <li
      key={n.key}
      className={`${card} ${lift} ${motion.beam} ${rise} gap-2`}
      style={{ "--i": i } as React.CSSProperties}
      data-insight={n.key}
    >
      <span className="text-small font-bold uppercase tracking-wider text-jaga-teal-ink">
        {t(n.tone === "good" ? "insights.good" : "insights.note")}
      </span>
      <p className="font-medium">{t(`insights.${n.key}.title` as never, n.values as never)}</p>
      <p className={hint}>{t(`insights.${n.key}.do` as never, n.values as never)}</p>
    </li>
  );

  return (
    <div className="flex flex-col gap-6" data-usage>
      <header className="flex flex-col gap-2">
        <h1 className="text-h2 font-bold text-jaga-ink">{t("title")}</h1>
        <p className={hint}>{t("subtitle")}</p>
        {example && <p className={notice}>{t("example")}</p>}
      </header>

      {/* ── The navy panel: now, today, and everything since the start ── */}
      <section
        className={`${consolePanel} ${nowClass} rounded-2xl p-5 text-white lg:p-7`}
        data-usage-panel
      >
        <div className="grid gap-6 lg:grid-cols-[auto_minmax(0,1fr)] lg:items-center">
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:gap-5">
            <div className="relative grid size-36 shrink-0 place-items-center lg:size-44">
              <span className={motion.radar} aria-hidden="true" />
              <div className="relative flex flex-col items-center">
                <span className="flex items-center gap-2 text-small font-bold tracking-widest text-jaga-teal-light">
                  <span className={motion.liveDot} aria-hidden="true" />
                  {t("now.tag")}
                </span>
                <span className="text-[3.25rem] font-bold leading-none" data-usage-live>
                  <CountUp value={d.now.live} format={format} />
                </span>
                <span className="text-small text-white/80">{t("now.unit")}</span>
              </div>
            </div>
            <ul className="flex w-full flex-col gap-1 text-small text-white/85 sm:w-auto">
              <li>{t("now.signedIn", { count: d.now.signedIn })}</li>
              <li>{t("now.installed", { count: d.now.installed })}</li>
              <li>{t("now.noArea", { count: d.now.noArea })}</li>
              {d.now.screens[0] && (
                <li>
                  {t("now.topScreen", {
                    screen: screenName(d.now.screens[0].k),
                    count: d.now.screens[0].n,
                  })}
                </li>
              )}
            </ul>
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-small text-white/80">{t("now.pulse")}</p>
            <TimeLine
              points={d.pulse}
              locale={locale}
              format={format}
              dark
              height="h-24"
              unitTip={(n) => t("now.pulseTip", { count: n })}
            />
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-4 border-t border-white/15 pt-5 lg:grid-cols-4">
          {(
            [
              ["devices", d.today.devices],
              ["sessions", d.today.sessions],
              ["newDevices", d.today.newDevices],
              ["minutes", d.today.minutes],
            ] as const
          ).map(([k, v], i) => (
            <div
              key={k}
              className={`flex flex-col gap-1 border-s-2 border-jaga-teal-light/60 ps-3 ${rise}`}
              style={{ "--i": i } as React.CSSProperties}
            >
              <span className="text-h2 font-bold">
                <CountUp value={v} format={format} />
              </span>
              <span className="text-small text-white/85">{t(`today.${k}`)}</span>
            </div>
          ))}
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-white/15 pt-5">
          <span className="text-small font-bold tracking-widest text-jaga-teal-light">
            {sinceText ? t("ever.since", { date: sinceText }) : t("ever.title")}
          </span>
          {(
            [
              ["devices", d.totals.devicesEver],
              ["sessions", d.totals.sessionsEver],
              ["views", d.totals.viewsEver],
              ["hours", Math.round(d.totals.minutesEver / 60)],
            ] as const
          ).map(([k, v]) => (
            <span key={k} className="flex items-baseline gap-2">
              <span className="text-h3 font-bold">{format(v)}</span>
              <span className="text-small text-white/80">{t(`ever.${k}`)}</span>
            </span>
          ))}
        </div>
      </section>

      {/* ── One row of controls for everything below it ── */}
      <nav className="flex flex-wrap items-center gap-2" aria-label={t("window.label")}>
        <span className="font-medium">{t("window.label")}</span>
        {USAGE_WINDOWS.map((w) => (
          <Link
            key={w}
            href={{ pathname: example ? "/dev/usage" : "/admin/usage", query: { days: w } }}
            aria-current={w === days ? "page" : undefined}
            className="inline-flex min-h-tap items-center rounded-full border border-jaga-line px-4 font-medium aria-[current=page]:border-jaga-teal aria-[current=page]:bg-jaga-slate aria-[current=page]:text-white"
            prefetch={false}
            scroll={false}
          >
            {t(`window.${w}` as never)}
          </Link>
        ))}
        <span className="ms-auto flex flex-wrap items-center gap-3 text-small text-jaga-text-2">
          {!example && (
            <>
              <span>
                {t("updated")} <DualTime iso={d.at} />
              </span>
              <button
                type="button"
                onClick={() => setPaused((p) => !p)}
                className="min-h-tap rounded-full border border-jaga-line px-3 font-medium text-jaga-ink"
              >
                {paused ? t("resume") : t("pause")}
              </button>
            </>
          )}
        </span>
        {failed && (
          <p role="status" className={`${notice} w-full`}>
            {t("pollFailed")}
          </p>
        )}
      </nav>

      {/* ── What the figures say ── */}
      {notes.length > 0 && (
        <Seen className="flex flex-col gap-3">
          <h2 className="text-h3 font-bold text-jaga-ink">{t("insights.title")}</h2>
          <ul className="grid gap-3 md:grid-cols-2 lg:grid-cols-3" data-usage-insights>
            {notes.slice(0, FIRST_INSIGHTS).map((n, i) => insightCard(n, i))}
          </ul>
          {notes.length > FIRST_INSIGHTS && (
            <details className="group flex flex-col gap-3">
              <summary className="inline-flex min-h-tap cursor-pointer items-center font-medium text-jaga-ink underline">
                {t("insights.more", { count: notes.length - FIRST_INSIGHTS })}
              </summary>
              <ul className="mt-3 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {notes.slice(FIRST_INSIGHTS).map((n, i) => insightCard(n, i))}
              </ul>
            </details>
          )}
        </Seen>
      )}

      {/* ── The map ── */}
      <section className={card} data-usage-map-card>
        <div className="flex flex-col gap-1">
          <h2 className="text-h3 font-bold text-jaga-ink">{t("map.title")}</h2>
          <p className={hint}>{t(`map.note.${layer}`)}</p>
        </div>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("map.layer")}>
          {(["areas", "watched", "ip"] as const).map((l) => (
            <button
              key={l}
              type="button"
              role="radio"
              aria-checked={layer === l}
              onClick={() => setLayer(l)}
              data-usage-layer={l}
              className="min-h-tap rounded-full border border-jaga-line px-4 font-medium aria-checked:border-jaga-teal aria-checked:bg-jaga-slate aria-checked:text-white"
            >
              {t(`map.layers.${l}`)}
            </button>
          ))}
          <label className="inline-flex min-h-tap items-center gap-2 rounded-full border border-jaga-line px-4 font-medium">
            <input
              type="checkbox"
              className="size-5 accent-jaga-teal-ink"
              checked={showLive}
              onChange={(e) => setShowLive(e.target.checked)}
            />
            {t("map.live")}
          </label>
          <span className="ms-auto inline-flex overflow-hidden rounded-full border border-jaga-line">
            {(["area", "world"] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                onClick={() => setView(v)}
                data-usage-view={v}
                className="min-h-tap px-4 font-medium aria-pressed:bg-jaga-slate aria-pressed:text-white"
              >
                {t(`map.view.${v}`)}
              </button>
            ))}
          </span>
        </div>
        <div ref={mapBox}>
          {mapNear ? (
            <UsageMap
              layer={layer}
              view={view}
              showLive={showLive}
              areas={d.areas}
              watched={d.watched}
              ip={d.ipPlaces}
              liveTambons={d.now.tambons}
              livePlaces={d.now.places}
              format={format}
              name={name}
              text={{
                loading: t("map.loading"),
                failed: t("map.failed"),
                liveLabel: (place, n) => t("map.liveLabel", { place, count: n }),
              }}
            />
          ) : (
            <div className="h-[56vh] min-h-80 rounded-xl border border-jaga-line bg-jaga-ground lg:h-[34rem]" />
          )}
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <div className="flex flex-col gap-2">
            <h3 className="font-bold">{t("map.topLive")}</h3>
            {d.now.tambons.length === 0 ? (
              <p className={hint}>{t("map.noneLive")}</p>
            ) : (
              <BarList
                rows={d.now.tambons.map((x) => ({ k: name(x), n: x.n }))}
                total={d.now.live}
                format={format}
                name={(k) => (k === "__rest" ? t("mix.rest") : k)}
                limit={6}
              />
            )}
          </div>
          <div className="flex flex-col gap-2">
            <h3 className="font-bold">{t("map.topAreas")}</h3>
            {d.areas.length === 0 ? (
              <p className={hint}>{t("map.noneYet")}</p>
            ) : (
              <BarList
                rows={d.areas.map((x) => ({ k: name(x), n: x.n }))}
                total={d.totals.devices}
                format={format}
                name={(k) => (k === "__rest" ? t("mix.rest") : k)}
                limit={6}
              />
            )}
          </div>
          <div className="flex flex-col gap-2">
            <h3 className="font-bold">{t("map.topWatched")}</h3>
            {d.watched.length === 0 ? (
              <p className={hint}>{t("map.noneYet")}</p>
            ) : (
              <BarList
                rows={d.watched.map((x) => ({ k: name(x), n: x.places + x.homes }))}
                total={d.watched.reduce((a, x) => a + x.places + x.homes, 0)}
                format={format}
                name={(k) => (k === "__rest" ? t("mix.rest") : k)}
                limit={6}
              />
            )}
            <p className={hint}>
              {t("map.watchedNote", {
                abroad: d.totals.abroadWatching,
              })}
            </p>
          </div>
        </div>
      </section>

      {/* ── Over time ── */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Seen className={card}>
          <h2 className="text-h3 font-bold text-jaga-ink">{t("days.title", { days })}</h2>
          <p className={hint}>{t("days.note")}</p>
          <DayBars series={d.series} alerts={d.alerts} locale={locale} format={format} />
        </Seen>
        <Seen className={card}>
          <h2 className="text-h3 font-bold text-jaga-ink">{t("hours.title")}</h2>
          <p className={hint}>{t("hours.note")}</p>
          <TimeLine
            points={d.hours}
            locale={locale}
            format={format}
            alerts={d.alerts}
            levelName={level}
            unitTip={(n) => t("hours.tip", { count: n })}
          />
          {lifts.length > 0 ? (
            <ul className="flex flex-col gap-1 text-small">
              {lifts.map((l) => (
                <li key={l.at}>
                  {l.ratio !== null
                    ? t("hours.lift", { level: level(l.level), ratio: l.ratio, after: l.after })
                    : t("hours.liftFromNothing", { level: level(l.level), after: l.after })}
                </li>
              ))}
            </ul>
          ) : (
            <p className={hint}>{t("hours.noAlerts")}</p>
          )}
        </Seen>
      </div>

      <Seen className={card}>
        <h2 className="text-h3 font-bold text-jaga-ink">{t("rhythm.title")}</h2>
        <p className={hint}>{t("rhythm.note")}</p>
        <Rhythm rhythm={d.rhythm} locale={locale} format={format} />
      </Seen>

      {/* ── How engaged ── */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Seen className={card}>
          <h2 className="text-h3 font-bold text-jaga-ink">{t("funnel.title")}</h2>
          <p className={hint}>{t("funnel.note")}</p>
          <Funnel steps={steps} format={format} name={(k) => t(`funnel.steps.${k}` as never)} />
        </Seen>
        <Seen className={card}>
          <h2 className="text-h3 font-bold text-jaga-ink">{t("engagement.title")}</h2>
          <div className="flex flex-wrap items-center gap-5">
            <Ring share={share(d.engagement.backWithinWeek, d.engagement.cohort)} size={112}>
              <span className="text-h3 font-bold">
                {share(d.engagement.backWithinWeek, d.engagement.cohort)}%
              </span>
            </Ring>
            <p className="min-w-0 flex-1">
              {d.engagement.cohort > 0
                ? t("engagement.comeBack", {
                    share: share(d.engagement.backWithinWeek, d.engagement.cohort),
                    cohort: d.engagement.cohort,
                  })
                : t("engagement.tooNew")}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Tile
              label={t("engagement.visit")}
              value={visit ? t("engagement.visitValue", { m: visit.m, s: visit.s }) : "–"}
            />
            <Tile
              label={t("engagement.pages")}
              value={d.engagement.medianViews !== null ? format(d.engagement.medianViews) : "–"}
            />
            <Tile
              label={t("engagement.perPhone")}
              value={
                d.engagement.sessionsPerDevice !== null
                  ? String(d.engagement.sessionsPerDevice)
                  : "–"
              }
              note={t("engagement.perPhoneNote", { days })}
            />
            <Tile
              label={t("engagement.sticky")}
              value={sticky !== null ? `${sticky}%` : "–"}
              note={t("engagement.stickyNote")}
            />
            <Tile
              label={t("engagement.still")}
              value={
                d.engagement.cohort > 0
                  ? `${share(d.engagement.stillAfterWeek, d.engagement.cohort)}%`
                  : "–"
              }
              note={t("engagement.stillNote")}
            />
            <Tile label={t("engagement.mau")} value={format(d.engagement.mau)} />
          </div>
        </Seen>
      </div>

      <Seen className={card}>
        <h2 className="text-h3 font-bold text-jaga-ink">{t("actions.title", { days })}</h2>
        <p className={hint}>{t("actions.note")}</p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6" data-usage-actions>
          {(
            ["sos", "reports", "accounts", "watchedPlaces", "pushSubs", "lineFollows"] as const
          ).map((k) => (
            <Tile key={k} label={t(`actions.${k}`)} value={format(d.actions[k])} />
          ))}
        </div>
      </Seen>

      {/* ── On what ── */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {(
          [
            ["device", d.mix.device],
            ["os", d.mix.os],
            ["browser", d.mix.browser],
            ["locale", d.mix.locale],
            ["net", d.mix.net],
            ["memory", d.mix.memory],
          ] as const
        ).map(([k, rows]) => (
          <Seen key={k} className={card}>
            <h2 className="text-h3 font-bold text-jaga-ink">{t(`mix.${k}`)}</h2>
            {rows.length === 0 ? (
              <p className={hint}>{t("map.noneYet")}</p>
            ) : (
              <BarList rows={rows} total={d.totals.devices} format={format} name={mixName(k)} />
            )}
          </Seen>
        ))}
        <Seen className={card}>
          <h2 className="text-h3 font-bold text-jaga-ink">{t("mix.inApp")}</h2>
          <p className={hint}>{t("mix.inAppNote")}</p>
          {d.mix.inApp.length === 0 ? (
            <p className={hint}>{t("mix.inAppNone")}</p>
          ) : (
            <BarList rows={d.mix.inApp} total={d.totals.devices} format={format} name={(k) => k} />
          )}
        </Seen>
        <Seen className={card}>
          <h2 className="text-h3 font-bold text-jaga-ink">{t("mix.country")}</h2>
          {d.mix.country.length === 0 ? (
            <p className={hint}>{t("map.noneYet")}</p>
          ) : (
            <BarList
              rows={d.mix.country}
              total={d.totals.devices}
              format={format}
              name={countryName}
            />
          )}
        </Seen>
        <Seen className={card}>
          <h2 className="text-h3 font-bold text-jaga-ink">{t("speed.title")}</h2>
          <p className={hint}>{t("speed.note", { count: d.speed.measured })}</p>
          <SpeedBar
            label={t("speed.fcp")}
            p50={d.speed.fcp50}
            p75={d.speed.fcp75}
            seconds={secondsText}
          />
          <SpeedBar
            label={t("speed.ready")}
            p50={d.speed.ready50}
            p75={d.speed.ready75}
            seconds={secondsText}
          />
        </Seen>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Seen className={card}>
          <h2 className="text-h3 font-bold text-jaga-ink">{t("screens.title")}</h2>
          <p className={hint}>{t("screens.note")}</p>
          {d.screens.length === 0 ? (
            <p className={hint}>{t("map.noneYet")}</p>
          ) : (
            <BarList
              rows={d.screens.map((s) => ({ k: s.k, n: s.views }))}
              total={d.screens.reduce((a, s) => a + s.views, 0)}
              format={format}
              name={screenName}
              limit={10}
            />
          )}
        </Seen>
        <Seen className={card}>
          <h2 className="text-h3 font-bold text-jaga-ink">{t("screens.entries")}</h2>
          <p className={hint}>{t("screens.entriesNote")}</p>
          {d.entries.length === 0 ? (
            <p className={hint}>{t("map.noneYet")}</p>
          ) : (
            <BarList
              rows={d.entries}
              total={d.entries.reduce((a, s) => a + s.n, 0)}
              format={format}
              name={screenName}
            />
          )}
        </Seen>
      </div>

      <section className={`${notice} flex flex-col gap-2`} data-usage-privacy>
        <h2 className="font-bold">{t("privacy.title")}</h2>
        <p>{t("privacy.counted")}</p>
        <p>{t("privacy.never")}</p>
        <p>{t("privacy.keep")}</p>
      </section>
    </div>
  );
}
