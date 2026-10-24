"use client";

import dynamic from "next/dynamic";
import { useLocale, useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { BasemapPicker } from "@/components/authority/BasemapPicker";
import {
  BoardNoticeLine,
  CONSOLE_VIEWS,
  type AlarmState,
  type BoardNotice,
  type ConsoleView,
  type UnitActions,
} from "@/components/authority/BoardView";
import { CaseCard, type CaseActions } from "@/components/authority/CaseCard";
import { CASE_MARKS } from "@/components/authority/marks";
import { TeamControls } from "@/components/authority/TeamControls";
import { ClockIcon, LifebuoyIcon, TriangleIcon } from "@/components/icons";
import { useLaptopView } from "@/lib/console-view";
import type { CoverageRow } from "@/lib/coverage";
import {
  caseState,
  clockText,
  filterCases,
  secondsLeft,
  sortCases,
  type AuthorityBoard,
  type BoardCase,
  type BoardKind,
  type BoardScope,
  type CaseMedia,
  type TeamRecord,
} from "@/lib/dispatch";
import { BASEMAPS, type Basemap } from "@/lib/map";
import { card, checkBox, checkRow, hint, input } from "@/lib/ui";

// MapLibre is loaded when the war room opens, never with the phone's list (slow 3G).
const BoardMap = dynamic(() => import("@/components/authority/BoardMap").then((m) => m.BoardMap), {
  ssr: false,
});

/**
 * The team's war room (the owner, 24 Oct 2026), for the person at a laptop or a tablet held
 * sideways: the queue of cases and the offer that is ringing on the left, the live map in the
 * middle on the main map's own basemaps, the case that was picked with its crew on the right
 * (under the map on a tablet), and the team's record along the foot.
 *
 * It is the same console with the same data and the same taps as the phone's board - CaseCard,
 * the alarm and the switches are the very components - laid out so a dispatcher sees everything
 * at once. It decides nothing and reads nothing itself (safety rule 5: what each tap may do is
 * checked again in the database).
 */

const BASEMAP_KEY = "jaga.team.basemap";

/** The basemap this person last chose here: a convenience, never needed (private windows throw). */
function savedBasemap(): Basemap {
  try {
    const kept = window.localStorage.getItem(BASEMAP_KEY);
    return BASEMAPS.find((b) => b === kept) ?? "streets";
  } catch {
    return "streets";
  }
}

type Loaded<T> = T | "failed" | null;

type Props = {
  board: AuthorityBoard;
  now: number;
  alarm: AlarmState;
  onArm: () => void;
  busy: string | null;
  notice: BoardNotice | null;
  phones: Record<string, string | null>;
  media: Record<string, CaseMedia | "failed">;
  stale: boolean;
  onRefresh: (() => void) | null;
  actions: CaseActions;
  unitActions: UnitActions;
  coverage: CoverageRow[] | null;
  record: Loaded<TeamRecord[]>;
  /** Updates arrive the moment a case changes (otherwise every few seconds). */
  live: boolean;
  /** The console's other views (reports, households, coverage, points) beside the war room. */
  view?: ConsoleView;
  onView?: (view: ConsoleView) => void;
  other?: ReactNode;
};

export function TeamWarRoom({
  board,
  now,
  alarm,
  onArm,
  busy,
  notice,
  phones,
  media,
  stale,
  onRefresh,
  actions,
  unitActions,
  coverage,
  record,
  live,
  view = "cases",
  onView,
  other = null,
}: Props) {
  const t = useTranslations("authority");
  const locale = useLocale();
  const laptop = useLaptopView();
  const [scope, setScope] = useState<BoardScope>("open");
  const [vulnerableOnly, setVulnerableOnly] = useState(false);
  const [kind, setKind] = useState<BoardKind>("all");
  const [picked, setPicked] = useState<string | null>(null);
  const [basemap, setBasemap] = useState<Basemap>(savedBasemap);

  const chooseBasemap = (next: Basemap) => {
    setBasemap(next);
    try {
      window.localStorage.setItem(BASEMAP_KEY, next);
    } catch {
      // Not remembered; it still changes for this visit.
    }
  };

  const sorted = sortCases(board.cases);
  const openCount = sorted.filter((c) => caseState(c) !== "closed").length;
  const closedCount = sorted.length - openCount;
  const shown = filterCases(sorted, { scope, tambon: null, vulnerableOnly, kind });
  const hasSupplies = sorted.some((c) => c.kind === "supplies");
  const ringing = sorted.filter(
    (c) =>
      c.kind !== "supplies" &&
      caseState(c) === "offered_to_me" &&
      Date.parse(c.offerExpiresAt ?? "") > now,
  );
  // The case in front: the one picked, or the offer that is ringing so that accepting is one tap.
  const pickedCase = picked ? sorted.find((c) => c.sosId === picked) : undefined;
  const current = pickedCase ?? ringing[0];

  const place = (c: BoardCase) =>
    (locale === "th" ? c.tambonNameTh : (c.tambonNameEn ?? c.tambonNameTh)) ?? "";

  const crewFor = (c: BoardCase) =>
    c.claimedBy && board.units.some((u) => u.id === c.claimedBy)
      ? {
          members: board.crew.filter((m) => m.unitId === c.claimedBy),
          assigned: board.assignments.filter((a) => a.sosId === c.sosId),
        }
      : undefined;

  const queue = (
    <section className={card} data-war-queue="true">
      <div className="flex flex-wrap items-center gap-2">
        {(["open", "closed"] as const).map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={scope === key}
            onClick={() => setScope(key)}
            className={`inline-flex min-h-tap items-center rounded-xl px-3 font-bold ${
              scope === key
                ? "bg-jaga-slate text-white"
                : "border-2 border-jaga-edge bg-jaga-surface text-jaga-ink"
            }`}
          >
            {t(`filter.${key}`, { count: key === "open" ? openCount : closedCount })}
          </button>
        ))}
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            className="inline-flex min-h-tap items-center rounded-xl border-2 border-jaga-edge px-3 text-small font-medium text-jaga-ink"
          >
            {t("refresh")}
          </button>
        )}
      </div>
      {hasSupplies && (
        <label className="flex flex-col gap-1">
          <span className="sr-only">{t("filter.kind.label")}</span>
          <select
            className={input}
            value={kind}
            onChange={(e) => setKind(e.target.value as BoardKind)}
          >
            {(["all", "rescue", "supplies"] as const).map((k) => (
              <option key={k} value={k}>
                {t(`filter.kind.${k}`)}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className={checkRow}>
        <input
          type="checkbox"
          className={checkBox}
          checked={vulnerableOnly}
          onChange={(e) => setVulnerableOnly(e.target.checked)}
        />
        <span>{t("filter.vulnerable")}</span>
      </label>
      {shown.length === 0 ? (
        <p className="font-medium">
          {scope === "closed"
            ? t("empty.closed")
            : openCount === 0
              ? t("empty.open")
              : t("empty.filtered")}
        </p>
      ) : (
        <ul className="flex max-h-[46vh] flex-col gap-2 overflow-y-auto pe-1">
          {shown.map((c) => {
            const state = caseState(c);
            const loud = state === "offered_to_me" || state === "unanswered";
            const left = secondsLeft(c, now);
            return (
              <li key={c.sosId}>
                <button
                  type="button"
                  aria-pressed={current?.sosId === c.sosId}
                  onClick={() => setPicked(c.sosId)}
                  data-war-case={c.sosId}
                  data-war-state={state}
                  className={`flex min-h-tap w-full flex-col gap-1 rounded-xl border-2 px-3 py-2 text-start ${
                    current?.sosId === c.sosId
                      ? "border-jaga-teal-ink bg-jaga-ground"
                      : "border-jaga-line bg-jaga-surface"
                  }`}
                >
                  <span className="flex items-center gap-2 font-bold text-jaga-ink">
                    {loud ? (
                      <span className="inline-flex items-center gap-1 rounded-lg bg-sos px-2 py-0.5 text-small text-sos-fg">
                        <TriangleIcon size={16} />
                        {state === "offered_to_me" ? t("war.offered") : t("war.unanswered")}
                      </span>
                    ) : state === "searching" ? (
                      <ClockIcon size={18} />
                    ) : (
                      <LifebuoyIcon size={18} />
                    )}
                    {place(c)}
                  </span>
                  <span className={hint}>
                    {t(`state.${state}`, { unit: c.claimedByName ?? c.offeredToName ?? "" })}
                    {c.peopleCount ? ` · ${t("war.people", { count: c.peopleCount })}` : ""}
                    {c.kind === "supplies" ? ` · ${t("filter.kind.supplies")}` : ""}
                  </span>
                  {state === "offered_to_me" && left != null && left > 0 && (
                    <span className="font-medium">{t("countdown", { time: clockText(left) })}</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );

  const map = (
    <section className="flex flex-col gap-2" data-war-map="true">
      <BasemapPicker value={basemap} onPick={chooseBasemap} />
      <div className="h-[62vh] min-h-[28rem]">
        <BoardMap
          cases={shown}
          coverage={coverage}
          mode="cases"
          picked={null}
          onPickCase={setPicked}
          onPickTambon={() => {}}
          text={{ loading: t("map.loading"), failed: t("map.failed") }}
          basemap={basemap}
          selected={current?.sosId ?? null}
          className="h-full w-full overflow-hidden rounded-xl border border-jaga-line"
        />
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-small" aria-label={t("war.legend")}>
        {CASE_MARKS.map((m) => (
          <li key={m.key} className="flex items-center gap-2">
            <span
              className="inline-block size-3.5 rounded-full"
              style={m.style}
              aria-hidden="true"
            />
            {t(`map.case.${m.key}`)}
          </li>
        ))}
      </ul>
    </section>
  );

  // People on the team, and what each is holding: only drawn once there is a second person.
  const rosters = board.units
    .map((unit) => ({ unit, members: board.crew.filter((m) => m.unitId === unit.id) }))
    .filter((r) => r.members.length > 1);
  const roster = rosters.length > 0 && (
    <section className={card} data-war-crew="true">
      <h2 className="font-bold text-jaga-ink">{t("war.crew")}</h2>
      {rosters.map(({ unit, members }) => (
        <div key={unit.id} className="flex flex-col gap-2">
          {rosters.length > 1 && <p className={hint}>{unit.name}</p>}
          <ul className="flex flex-col gap-1">
            {members.map((m) => {
              const holding = board.assignments
                .filter((a) => a.userId === m.userId)
                .map((a) => sorted.find((c) => c.sosId === a.sosId))
                .filter((c): c is BoardCase => !!c);
              return (
                <li key={m.userId} className="flex flex-col" data-crew-member={m.userId}>
                  <span className="font-medium">
                    {m.name || t("crew.noName")}{" "}
                    <span className={hint}>· {t(`crew.role.${m.role}`)}</span>
                  </span>
                  <span className={hint}>
                    {holding.length === 0
                      ? t("war.free")
                      : holding.map((c) => place(c)).join(" · ")}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );

  const panel = (
    <div className="flex flex-col gap-4" data-war-panel="true">
      {current ? (
        <CaseCard
          key={current.sosId}
          c={current}
          now={now}
          busy={busy === current.sosId}
          phone={current.sosId in phones ? { number: phones[current.sosId] ?? null } : null}
          media={media[current.sosId] ?? null}
          actions={actions}
          crew={crewFor(current)}
        />
      ) : (
        <p className={`${card} font-medium`}>{t("war.pick")}</p>
      )}
      {roster}
    </div>
  );

  const foot = (
    <section className={card} data-war-record="true">
      <h2 className="font-bold text-jaga-ink">{t("war.record.title")}</h2>
      {record === null && <p className={hint}>{t("views.loading")}</p>}
      {record === "failed" && <p className={hint}>{t("war.record.failed")}</p>}
      {Array.isArray(record) &&
        record.map((r) => (
          <div key={r.unitId} className="flex flex-col gap-2" data-record-unit={r.unitId}>
            <p className="font-medium">
              {record.length > 1 ? `${r.unitName} · ` : ""}
              {r.cases === 0
                ? t("points.none")
                : t("points.mine", { points: r.points, cases: r.cases })}
            </p>
            {r.members.length > 1 && (
              <table className="w-full text-start text-small">
                <thead>
                  <tr className="text-jaga-text-2">
                    <th className="py-1 text-start font-medium">{t("war.record.person")}</th>
                    <th className="py-1 text-end font-medium">{t("war.record.taken")}</th>
                    <th className="py-1 text-end font-medium">{t("war.record.reported")}</th>
                  </tr>
                </thead>
                <tbody>
                  {r.members.map((m) => (
                    <tr key={m.userId} className="border-t border-jaga-line">
                      <td className="py-1">{m.name || t("crew.noName")}</td>
                      <td className="py-1 text-end tabular-nums">{m.casesTaken}</td>
                      <td className="py-1 text-end tabular-nums">{m.rescuesReported}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ))}
      <p className={hint}>{t("points.rule")}</p>
    </section>
  );

  return (
    <div
      className="flex flex-col gap-4"
      data-team-war-room={laptop ? "laptop" : "tablet"}
      data-live={live}
    >
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-h3 font-bold text-jaga-ink">{t("title")}</h1>
          <p className={hint} data-war-live={live ? "live" : "poll"}>
            {live ? t("war.live") : t("war.poll")}
          </p>
        </div>
        {stale && (
          <p
            role="status"
            className="rounded-xl border-2 border-jaga-edge bg-jaga-ground px-4 py-2 font-medium"
          >
            {t("pollFailed")}
          </p>
        )}
        {notice && <BoardNoticeLine notice={notice} />}
        {ringing.length > 0 && (
          <p
            role="alert"
            className="flex items-center gap-2 rounded-2xl bg-sos px-4 py-3 text-h3 font-bold text-sos-fg"
          >
            <TriangleIcon size={24} />
            {t("alarm.ringing", { count: ringing.length })}
          </p>
        )}
      </header>

      {onView && (
        <nav aria-label={t("views.label")} className="flex flex-wrap gap-2" data-war-views="true">
          {/* The war room is the case list and the map together, so the "map" view has no tab of its own. */}
          {CONSOLE_VIEWS.filter((key) => key !== "map").map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={view === key}
              onClick={() => onView(key)}
              data-console-view={key}
              className={`inline-flex min-h-tap items-center rounded-xl px-4 font-medium ${
                view === key
                  ? "bg-jaga-teal-ink text-white"
                  : "border border-jaga-edge bg-jaga-surface text-jaga-ink"
              }`}
            >
              {key === "cases" ? t("war.home") : t(`views.${key}`)}
            </button>
          ))}
        </nav>
      )}

      {view !== "cases" ? (
        other
      ) : laptop ? (
        <div className="grid grid-cols-[minmax(300px,340px)_minmax(0,1fr)_minmax(360px,420px)] items-start gap-4">
          <div className="flex flex-col gap-4">
            {queue}
            <TeamControls
              alarm={alarm}
              onArm={onArm}
              units={board.units}
              unitActions={unitActions}
            />
          </div>
          {map}
          {panel}
        </div>
      ) : (
        <div className="grid grid-cols-[minmax(280px,320px)_minmax(0,1fr)] items-start gap-4">
          <div className="flex flex-col gap-4">
            {queue}
            <TeamControls
              alarm={alarm}
              onArm={onArm}
              units={board.units}
              unitActions={unitActions}
            />
          </div>
          <div className="flex flex-col gap-4">
            {map}
            {panel}
          </div>
        </div>
      )}
      {view === "cases" && foot}
    </div>
  );
}
