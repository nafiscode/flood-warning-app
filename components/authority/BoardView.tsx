"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { CaseCard, type CaseActions } from "@/components/authority/CaseCard";
import { BellIcon, CheckIcon, TriangleIcon } from "@/components/icons";
import {
  caseState,
  filterCases,
  sortCases,
  tambonsOnBoard,
  type AuthorityBoard,
  type BoardKind,
  type BoardScope,
  type CaseMedia,
} from "@/lib/dispatch";
import { buttonPrimary, card, checkBox, checkRow, hint, input } from "@/lib/ui";

const BOARD_KINDS: BoardKind[] = ["all", "rescue", "supplies"];

/**
 * The authority console as it is drawn (spec 5.1, 5.2): the alarm's own switch, the team's
 * on-duty switch, and the cases in the team's coverage, the one ringing this phone first.
 *
 * It decides nothing and reads nothing: the board, the clock and what every tap does come in as
 * props, so the example page and the tests draw exactly what a responder sees. Three rules hold:
 *  - a state is never colour alone: icon, words and colour together (docs/brand.md);
 *  - the only hue that carries a state is the SOS red, as a filled badge with its own background;
 *  - no phone number is on the board. One is shown after a tap, for one case, and that tap is
 *    written to the access log by the database (safety rule 5).
 */

export type AlarmState = "off" | "on" | "none";

/** The console's views: the case list, the cases on a map, the responsibility map, the points. */
export type ConsoleView = "cases" | "map" | "coverage" | "reports" | "households" | "points";
export const CONSOLE_VIEWS: ConsoleView[] = [
  "cases",
  "map",
  "reports",
  "households",
  "coverage",
  "points",
];

export type UnitActions = {
  duty: (unitId: string, on: boolean) => void;
  sharing: (unitId: string, on: boolean) => void;
};

export type BoardNotice =
  | { kind: "taken"; unit: string | null }
  | { kind: "accepted" }
  | { kind: "completed" }
  | { kind: "confirmed" }
  | { kind: "upload" }
  | { kind: "refused" }
  | { kind: "failed" };

type Props = {
  board: AuthorityBoard;
  /** The server's clock in milliseconds, moving every second while an offer is counting down. */
  now: number;
  alarm: AlarmState;
  onArm: () => void;
  /** The case a tap is being saved for, so its buttons wait instead of taking a second tap. */
  busy: string | null;
  notice: BoardNotice | null;
  /** Numbers already asked for in this sitting, by case. A key with null: the sender gave none. */
  phones: Record<string, string | null>;
  /** Photos and voice notes already asked for in this sitting, by case. */
  media: Record<string, CaseMedia | "failed">;
  /** The last refresh failed: the board on screen is standing still. */
  stale: boolean;
  onRefresh: (() => void) | null;
  actions: CaseActions;
  unitActions: UnitActions;
  /** Which view is open. The alarm and the team's switches stay on screen in every one. */
  view?: ConsoleView;
  onView?: (view: ConsoleView) => void;
  /** What a view other than the case list shows, drawn by whoever holds its data. */
  other?: ReactNode;
};

/** A notice that something worked, against one that says it did not. */
const good = (notice: BoardNotice) =>
  notice.kind === "accepted" || notice.kind === "completed" || notice.kind === "confirmed";

export function BoardView({
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
  view = "cases",
  onView,
  other = null,
}: Props) {
  const t = useTranslations("authority");
  const locale = useLocale();
  const [scope, setScope] = useState<BoardScope>("open");
  const [tambon, setTambon] = useState<string | null>(null);
  const [vulnerableOnly, setVulnerableOnly] = useState(false);
  const [kind, setKind] = useState<BoardKind>("all");

  const sorted = sortCases(board.cases);
  const openCount = sorted.filter((c) => caseState(c) !== "closed").length;
  const closedCount = sorted.length - openCount;
  const tambons = tambonsOnBoard(board.cases);
  const shown = filterCases(sorted, { scope, tambon, vulnerableOnly, kind });
  // Only a rescue case rings; a request for food and water has its own soft sound (spec 4.10).
  const ringing = sorted.filter(
    (c) =>
      c.kind !== "supplies" &&
      caseState(c) === "offered_to_me" &&
      Date.parse(c.offerExpiresAt ?? "") > now,
  ).length;
  const hasSupplies = sorted.some((c) => c.kind === "supplies");

  const tab = (key: BoardScope, text: string) => (
    <button
      key={key}
      type="button"
      aria-pressed={scope === key}
      onClick={() => setScope(key)}
      className={`inline-flex min-h-tap items-center rounded-xl px-4 font-bold ${
        scope === key
          ? "bg-jaga-slate text-white"
          : "border-2 border-jaga-edge bg-jaga-surface text-jaga-ink"
      }`}
    >
      {text}
    </button>
  );

  return (
    <div className="flex flex-col gap-5" data-board-ringing={ringing}>
      <header className="flex flex-col gap-2">
        <h1 className="text-h3 font-bold text-jaga-ink">{t("title")}</h1>
        <p className={hint}>{t("subtitle")}</p>
        {stale && (
          <p
            role="status"
            className="rounded-xl border-2 border-jaga-edge bg-jaga-ground px-4 py-2 font-medium"
          >
            {t("pollFailed")}
          </p>
        )}
        {notice && (
          <p
            role={good(notice) ? "status" : "alert"}
            data-board-notice={notice.kind}
            className={`rounded-xl border-2 bg-jaga-surface px-4 py-2 font-medium ${
              good(notice) ? "border-jaga-teal-ink" : "border-sos"
            }`}
          >
            {notice.kind === "taken"
              ? notice.unit
                ? t("notice.taken", { unit: notice.unit })
                : t("notice.takenNoName")
              : t(`notice.${notice.kind}`)}
          </p>
        )}
      </header>

      {/* The offer itself, said in words as well as in sound: sound is never the only channel. */}
      {ringing > 0 && (
        <p
          role="alert"
          className="flex items-center gap-2 rounded-2xl bg-sos px-4 py-3 text-h3 font-bold text-sos-fg"
        >
          <TriangleIcon size={24} />
          {t("alarm.ringing", { count: ringing })}
        </p>
      )}

      {/* Two columns on a laptop: the team's own switches beside the cases. */}
      <div className="flex flex-col gap-5 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:items-start lg:gap-6">
        <div className="flex flex-col gap-4">
          <section className={card} data-alarm={alarm}>
            <h2 className="flex items-center gap-2 font-bold text-jaga-ink">
              <BellIcon size={22} />
              {t("alarm.title")}
            </h2>
            {alarm === "on" && (
              <p className="flex items-center gap-2 font-medium">
                <CheckIcon size={20} />
                {t("alarm.on")}
              </p>
            )}
            {alarm === "off" && (
              <>
                <p className="font-medium">{t("alarm.off")}</p>
                <button type="button" onClick={onArm} className={buttonPrimary}>
                  {t("alarm.arm")}
                </button>
              </>
            )}
            {alarm === "none" && <p className="font-medium">{t("alarm.none")}</p>}
            <p className={hint}>{t("alarm.openOnly")}</p>
          </section>

          {board.units.map((unit) => (
            <section key={unit.id} className={card} data-unit={unit.id}>
              <div className="flex flex-col">
                <h2 className="font-bold text-jaga-ink">{unit.name}</h2>
                {unit.orgName && <p className={hint}>{unit.orgName}</p>}
              </div>
              <label className={checkRow}>
                <input
                  type="checkbox"
                  className={checkBox}
                  checked={unit.onDuty}
                  onChange={(e) => unitActions.duty(unit.id, e.target.checked)}
                  data-duty="true"
                />
                <span className="flex flex-col">
                  <span className="font-bold">
                    {unit.onDuty ? t("unit.onDuty") : t("unit.offDuty")}
                  </span>
                  <span className={hint}>{t("unit.dutyHint")}</span>
                </span>
              </label>
              {unit.isOwner && (
                <label className={checkRow}>
                  <input
                    type="checkbox"
                    className={checkBox}
                    checked={unit.sharesPocPhone}
                    onChange={(e) => unitActions.sharing(unit.id, e.target.checked)}
                    data-sharing="true"
                  />
                  <span className="flex flex-col">
                    <span className="font-medium">{t("unit.sharing")}</span>
                    {!unit.sharesPocPhone && <span className={hint}>{t("unit.sharingOff")}</span>}
                  </span>
                </label>
              )}
            </section>
          ))}
        </div>

        <div className="flex flex-col gap-4">
          {onView && (
            <nav aria-label={t("views.label")} className="flex flex-wrap gap-2">
              {CONSOLE_VIEWS.map((key) => (
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
                  {t(`views.${key}`)}
                </button>
              ))}
            </nav>
          )}
          {view !== "cases" ? other : caseList()}
        </div>
      </div>
    </div>
  );

  function caseList() {
    return (
      <>
        <div className="flex flex-wrap items-center gap-2">
          {tab("open", t("filter.open", { count: openCount }))}
          {tab("closed", t("filter.closed", { count: closedCount }))}
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
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
          {tambons.length > 1 && (
            <label className="flex flex-col gap-1 sm:flex-1">
              <span className="sr-only">{t("filter.tambon")}</span>
              <select
                className={input}
                value={tambon ?? ""}
                onChange={(e) => setTambon(e.target.value || null)}
              >
                <option value="">{t("filter.allTambons")}</option>
                {tambons.map((x) => (
                  <option key={x.code} value={x.code}>
                    {locale === "th" ? x.th : `${x.th} (${x.en})`}
                  </option>
                ))}
              </select>
            </label>
          )}
          {hasSupplies && (
            <label className="flex flex-col gap-1">
              <span className="sr-only">{t("filter.kind.label")}</span>
              <select
                className={input}
                value={kind}
                data-filter-kind="true"
                onChange={(e) => setKind(e.target.value as BoardKind)}
              >
                {BOARD_KINDS.map((k) => (
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
        </div>

        {shown.length === 0 && (
          <p className="rounded-2xl border border-jaga-line bg-jaga-surface p-5 font-medium">
            {scope === "closed"
              ? t("empty.closed")
              : openCount === 0
                ? t("empty.open")
                : t("empty.filtered")}
          </p>
        )}
        {shown.map((c) => (
          <CaseCard
            key={c.sosId}
            c={c}
            now={now}
            busy={busy === c.sosId}
            phone={c.sosId in phones ? { number: phones[c.sosId] ?? null } : null}
            media={media[c.sosId] ?? null}
            actions={actions}
            crew={
              c.claimedBy && board.units.some((u) => u.id === c.claimedBy)
                ? {
                    members: board.crew.filter((m) => m.unitId === c.claimedBy),
                    assigned: board.assignments.filter((a) => a.sosId === c.sosId),
                  }
                : undefined
            }
          />
        ))}
      </>
    );
  }
}
