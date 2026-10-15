"use client";

import { useFormatter, useTranslations } from "next-intl";
import { PhoneIcon } from "@/components/icons";
import { OpenMeteoAttribution } from "@/components/OpenMeteoAttribution";
import {
  coastGrade,
  metres,
  outlook,
  SEA_LIMITS,
  tide,
  type CoastId,
  type SeaData,
  type SeaGrade,
  type SeaHour,
  type SeaOutlook,
  type SeaPoint,
  waveRange,
} from "@/lib/sea";
import { MoreButton } from "./MapPeek";
import type { LoadState } from "@/lib/use-public";
import styles from "./Sea.module.css";

/** The numbers a fisherman needs, beside the app's four (safety rule 4 keeps those on every page). */
export const SEA_LINES = [
  { key: "marine", number: "1199" },
  { key: "tmd", number: "1182" },
] as const;
export const TMD_URL = "https://www.tmd.go.th/";

const BANGKOK_HOUR = {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "Asia/Bangkok",
} as const satisfies Intl.DateTimeFormatOptions;
const BANGKOK_WEEKDAY = { weekday: "short", timeZone: "Asia/Bangkok" } as const;

/**
 * A small drawing of the grade: one low line for a calm sea, two for rough, a boat tied up beside
 * high waves for "stay in port", a dashed line with no forecast. Decorative: the words always
 * say the grade (never colour alone), and no alert colour is used (safety rule 2).
 */
export function SeaGradeIcon({ grade, size = 28 }: { grade: SeaGrade; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 28 28"
      className="shrink-0"
      data-sea-icon={grade}
    >
      <g className={styles.ink} fill="none" strokeWidth="2.2" strokeLinecap="round">
        {grade === "unknown" && <path d="M3 17 H25" strokeDasharray="3 3" />}
        {grade === "calm" && <path d="M3 18 Q8.5 15.5 14 18 T25 18" />}
        {grade === "rough" && (
          <>
            <path d="M3 13 Q8.5 8 14 13 T25 13" />
            <path d="M3 21 Q8.5 16 14 21 T25 21" />
          </>
        )}
        {grade === "stay" && (
          <>
            <path d="M2 23 Q6 15 10 23 T18 23" />
            <path d="M15 14 H26 L24 18 H17 Z" strokeLinejoin="round" />
            <path d="M20.5 14 V7" />
            <path d="M26 4 V25" strokeWidth="1.6" />
          </>
        )}
      </g>
    </svg>
  );
}

function Calls() {
  const t = useTranslations("sea");
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {SEA_LINES.map(({ key, number }) => (
        <li key={key}>
          <a
            href={`tel:${number}`}
            data-sea-call={number}
            className="flex min-h-tap w-full items-center gap-3 rounded-xl border-2 border-jaga-edge bg-jaga-surface px-4 py-2 text-jaga-ink active:translate-y-px"
          >
            <PhoneIcon size={22} />
            <span className="flex flex-col leading-tight">
              <span className="font-bold">{number}</span>
              <span className="text-small">{t(`call.${key}`)}</span>
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}

/** The note for one point: the grade in words, the figures behind it, and what to do. */
export function SeaNote({ view, name }: { view: SeaOutlook; name: string }) {
  const t = useTranslations("sea");
  const format = useFormatter();
  const at = (ms: number | null) =>
    ms === null ? "–" : format.dateTime(new Date(ms), BANGKOK_HOUR);
  const figures = {
    range: waveRange(view.waveMin, view.waveMax),
    max: metres(view.waveMax),
    at: at(view.waveMaxAt),
    wind: Math.round(view.windMax ?? 0),
    gust: Math.round(view.gustMax ?? 0),
  };
  return (
    <div
      className={`flex flex-col gap-2 rounded-xl bg-jaga-ground p-4 ${
        view.grade === "stay" ? "border-2 border-jaga-edge" : "border border-jaga-line"
      }`}
      data-sea-note={view.grade}
    >
      <p className="text-small font-medium text-jaga-text-2">{name}</p>
      <p className="flex items-center gap-2 text-h3 font-bold text-jaga-ink">
        <SeaGradeIcon grade={view.grade} />
        {t(`grade.${view.grade}.title`)}
      </p>
      {view.grade !== "unknown" && (
        <p data-sea-figures="true">
          {view.grade === "calm" ? t("note.calm", figures) : t("note.high", figures)}
        </p>
      )}
      {view.reasons.length > 0 && (
        <ul className="flex flex-col gap-1" data-sea-reasons="true">
          {view.reasons.map((r) => (
            <li key={r} className="border-s-4 border-jaga-edge ps-2 text-small">
              {t(`reason.${r}`)}
            </li>
          ))}
        </ul>
      )}
      <p className="font-medium">{t(`advice.${view.grade}`)}</p>
    </div>
  );
}

/**
 * The waves of the next two days, one bar an hour on a scale that always reaches 2.5 m, so the
 * two cut-offs (1 m rough, 2 m stay in port) are always drawn and a calm sea looks calm. One
 * colour (the map's water), named by the title; the figures are in a table for anyone who
 * cannot see the bars, and each bar carries its own as a tooltip.
 */
export function WaveChart({ hours, now }: { hours: SeaHour[]; now: number }) {
  const t = useTranslations("sea");
  const format = useFormatter();
  const ahead = hours.filter((h) => h.t >= now - 3_600_000 && h.wave !== null);
  if (ahead.length < 6) return null;
  const top = Math.max(2.5, ...ahead.map((h) => (h.wave as number) * 1.15));
  const y = (m: number) => 100 - (m / top) * 100;
  const width = 100 / ahead.length;
  const time = (ms: number) => format.dateTime(new Date(ms), BANGKOK_HOUR);
  const day = (ms: number) => format.dateTime(new Date(ms), BANGKOK_WEEKDAY);
  // A tick at each Bangkok midnight and noon.
  const ticks = ahead
    .map((h, i) => ({ h, i }))
    .filter(({ h }) => [0, 12].includes(new Date(h.t + 7 * 3_600_000).getUTCHours()));
  return (
    <figure className="flex flex-col gap-2" data-sea-chart="waves">
      <figcaption className="font-bold text-jaga-ink">{t("waves.title")}</figcaption>
      <div className="relative h-36 w-full max-w-[34rem]">
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full overflow-visible"
          aria-hidden="true"
        >
          <line
            x1="0"
            x2="100"
            y1="100"
            y2="100"
            className="stroke-jaga-line"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
          {[SEA_LIMITS.roughWaveM, SEA_LIMITS.stayWaveM].map((m) => (
            <line
              key={m}
              x1="0"
              x2="100"
              y1={y(m)}
              y2={y(m)}
              className="stroke-jaga-text-2"
              strokeWidth="1"
              strokeDasharray="4 3"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {ahead.map((h, i) => (
            <rect
              key={h.t}
              x={i * width + width * 0.12}
              width={width * 0.76}
              y={y(h.wave as number)}
              height={Math.max(0.6, 100 - y(h.wave as number))}
              className={styles.bar}
            >
              <title>{`${time(h.t)} · ${metres(h.wave)} m`}</title>
            </rect>
          ))}
        </svg>
        {[
          [SEA_LIMITS.roughWaveM, "rough"],
          [SEA_LIMITS.stayWaveM, "stay"],
        ].map(([m, key]) => (
          <span
            key={key}
            className="absolute end-0 -translate-y-full bg-jaga-surface/80 px-1 text-small text-jaga-text-2"
            style={{ top: `${y(m as number)}%` }}
          >
            {t(`waves.line.${key}`, { m: m as number })}
          </span>
        ))}
      </div>
      <div
        className="relative h-5 w-full max-w-[34rem] text-small text-jaga-text-2"
        aria-hidden="true"
      >
        {ticks.map(({ h, i }) => (
          <span
            key={h.t}
            className="absolute -translate-x-1/2 whitespace-nowrap rtl:translate-x-1/2"
            style={{ insetInlineStart: `${(i + 0.5) * width}%` }}
          >
            {new Date(h.t + 7 * 3_600_000).getUTCHours() === 0 ? day(h.t) : time(h.t)}
          </span>
        ))}
      </div>
      <details className="text-small">
        <summary className="min-h-tap cursor-pointer py-2 font-medium">{t("waves.table")}</summary>
        <table className="w-full text-start">
          <thead>
            <tr>
              <th className="text-start">{t("waves.col.time")}</th>
              <th className="text-start">{t("waves.col.wave")}</th>
              <th className="text-start">{t("waves.col.wind")}</th>
              <th className="text-start">{t("waves.col.gust")}</th>
            </tr>
          </thead>
          <tbody>
            {ahead
              .filter((_, i) => i % 3 === 0)
              .map((h) => (
                <tr key={h.t}>
                  <td>{`${day(h.t)} ${time(h.t)}`}</td>
                  <td>{metres(h.wave)}</td>
                  <td>{h.wind === null ? "–" : Math.round(h.wind)}</td>
                  <td>{h.gust === null ? "–" : Math.round(h.gust)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

/**
 * The tide: a curve of the model's sea level with no heights on it (the model sits about 0.7 m
 * off the tide gauges here), the water under it lapping, a mark for now, and the coming turns
 * in words. What is said is when it rises and falls, which is what a boat leaving a river mouth
 * needs.
 */
export function TideCurve({ hours, now }: { hours: SeaHour[]; now: number }) {
  const t = useTranslations("sea");
  const format = useFormatter();
  const view = tide({ hours }, now);
  if (!view) return <p className="text-small text-jaga-text-2">{t("tide.none")}</p>;
  const first = view.curve[0]!.t;
  const last = view.curve.at(-1)!.t;
  const x = (ms: number) => ((ms - first) / (last - first)) * 100;
  const yOf = (v: number) => 88 - v * 76;
  const line = view.curve.map((p, i) => `${i ? "L" : "M"}${x(p.t)},${yOf(p.y)}`).join(" ");
  const area = `${line} L100,100 L0,100 Z`;
  const nowX = Math.max(0, Math.min(100, x(now)));
  const time = (ms: number) => format.dateTime(new Date(ms), BANGKOK_HOUR);
  const day = (ms: number) => format.dateTime(new Date(ms), BANGKOK_WEEKDAY);
  const next = view.turns.slice(0, 3);
  return (
    <figure className="flex flex-col gap-2" data-sea-chart="tide">
      <figcaption className="flex items-center gap-2 font-bold text-jaga-ink">
        {t("tide.title")}
        <span className="font-medium" data-tide-now={view.now}>
          · {t(`tide.${view.now}`)}
        </span>
      </figcaption>
      <div className="relative h-24 w-full max-w-[34rem]">
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full"
          aria-hidden="true"
        >
          <path d={area} className={styles.tideArea} />
          <path d={line} className={styles.tideLine} vectorEffect="non-scaling-stroke" />
          <path d={line} className={styles.tideFlow} vectorEffect="non-scaling-stroke" />
          <line
            x1={nowX}
            x2={nowX}
            y1="0"
            y2="100"
            className="stroke-jaga-ink"
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <span
          className={`absolute -translate-x-1/2 -translate-y-1/2 rtl:translate-x-1/2 ${styles.nowDot}`}
          style={{
            insetInlineStart: `${nowX}%`,
            top: `${yOf(
              view.curve.reduce((a, b) => (Math.abs(b.t - now) < Math.abs(a.t - now) ? b : a)).y,
            )}%`,
          }}
          aria-hidden="true"
        />
        <span
          className="absolute top-0 -translate-x-1/2 bg-jaga-surface/80 px-1 text-small font-bold text-jaga-ink rtl:translate-x-1/2"
          style={{ insetInlineStart: `${nowX}%` }}
        >
          {t("tide.nowLabel")}
        </span>
      </div>
      {next.length > 0 && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1" data-tide-turns="true">
          {next.map((turn) => (
            <li key={turn.t}>
              {t(`tide.${turn.kind}`, { time: `${day(turn.t)} ${time(turn.t)}` })}
            </li>
          ))}
        </ul>
      )}
      <p className="text-small text-jaga-text-2">{t("tide.note")}</p>
    </figure>
  );
}

/**
 * The Sea and coast section under the map (the owner, 15 Oct 2026): along the coast at a glance,
 * then the chosen point's note for fishermen, its waves and its tide. Advisory and from a model:
 * it never says the sea is safe, it says where its figures come from and when, and it hands the
 * official word to TMD and the Marine Department (safety rules 2 and 8).
 */
export function SeaSection({
  data,
  state,
  now,
  pointId,
  onPoint,
}: {
  data: SeaData | null;
  state: LoadState;
  now: number;
  pointId: CoastId | null;
  onPoint: (id: CoastId) => void;
}) {
  const t = useTranslations("sea");
  const format = useFormatter();
  const coast = coastGrade(data, now);
  const views = (data?.points ?? []).map((p) => ({ point: p, view: outlook(p, now) }));
  const chosen =
    views.find((v) => v.point.id === pointId) ??
    [...views].sort((a, b) => rankOf(b.view.grade) - rankOf(a.view.grade))[0];
  return (
    <section
      className="flex flex-col gap-4 rounded-2xl border border-jaga-line bg-jaga-surface p-5"
      data-sea-section={coast}
      aria-labelledby="sea-title"
    >
      <div className="flex flex-col gap-1">
        <h2 id="sea-title" className="text-h3 font-bold text-jaga-ink">
          {t("title")}
        </h2>
        <p className="text-small text-jaga-text-2">{t("intro")}</p>
      </div>
      {!data && state === "loading" && <p>{t("loading")}</p>}
      {!data && state !== "loading" && (
        <p className="font-medium" data-sea-failed="true">
          {t("failed")}
        </p>
      )}
      {data && (
        <>
          <p className="flex items-center gap-2 font-bold" data-sea-headline={coast}>
            <SeaGradeIcon grade={coast} size={24} />
            {t(`headline.${coast}`)}
          </p>
          <div className="flex flex-col gap-2">
            <p className="font-medium" id="sea-points">
              {t("pick")}
            </p>
            <ul
              className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap"
              aria-labelledby="sea-points"
            >
              {views.map(({ point, view }) => (
                <li key={point.id}>
                  <button
                    type="button"
                    data-sea-point={point.id}
                    aria-pressed={chosen?.point.id === point.id}
                    onClick={() => onPoint(point.id)}
                    className={`flex min-h-tap w-full flex-col items-start justify-center rounded-xl border-2 px-3 py-1 text-start leading-tight active:translate-y-px sm:w-auto ${
                      chosen?.point.id === point.id
                        ? "border-jaga-edge bg-jaga-slate text-white"
                        : "border-jaga-line bg-jaga-surface text-jaga-ink hover:border-jaga-teal-ink"
                    }`}
                  >
                    <span className="font-bold">{t(`points.${point.id}`)}</span>
                    <span className="text-small">{t(`grade.${view.grade}.short`)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          {chosen && (
            <>
              <SeaNote
                view={chosen.view}
                name={t("offshore", { place: t(`points.${chosen.point.id}`) })}
              />
              <WaveChart hours={chosen.point.hours} now={now} />
              <TideCurve hours={chosen.point.hours} now={now} />
            </>
          )}
        </>
      )}
      <p className="rounded-lg bg-jaga-ground p-3 text-small">{t("model")}</p>
      <Calls />
      <a
        href={TMD_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="text-jaga-teal-ink underline"
        data-sea-tmd="true"
      >
        {t("tmdLink")}
      </a>
      <p className="text-small text-jaga-text-2">{t("surge")}</p>
      {data && (
        <p className="text-small text-jaga-text-2">
          {t("fetched", {
            time: format.dateTime(new Date(data.fetchedAt), {
              day: "numeric",
              month: "short",
              ...BANGKOK_HOUR,
            }),
          })}
        </p>
      )}
      <OpenMeteoAttribution />
    </section>
  );
}

const rankOf = (g: SeaGrade) => ({ unknown: 0, calm: 1, rough: 2, stay: 3 })[g];

/**
 * The small pop-up on a sea point (the owner, 15 Oct): the note's grade, the waves of the next
 * day and the tide, with the button down to the whole Sea and coast card. The short lines only;
 * the card keeps the figures, the advice and the numbers to call.
 */
export function SeaPeek({
  point,
  now,
  onMore,
}: {
  point: SeaPoint;
  now: number;
  onMore: () => void;
}) {
  const t = useTranslations("sea");
  const view = outlook(point, now);
  const turn = tide(point, now);
  return (
    <div className="flex flex-col gap-1 text-jaga-text" data-peek="sea" data-peek-id={point.id}>
      <p className="text-small text-jaga-text-2">
        {t("offshore", { place: t(`points.${point.id}`) })}
      </p>
      <p className="flex items-center gap-2 font-bold">
        <SeaGradeIcon grade={view.grade} size={24} />
        {t(`grade.${view.grade}.title`)}
      </p>
      {view.grade !== "unknown" && (
        <p className="text-small">{t("mark", { range: waveRange(view.waveMin, view.waveMax) })}</p>
      )}
      {turn && (
        <p className="text-small">
          {t("tide.title")} · {t(`tide.${turn.now}`)}
        </p>
      )}
      <p className="text-small text-jaga-text-2">{t("peekNote")}</p>
      <MoreButton onMore={onMore} />
    </div>
  );
}
