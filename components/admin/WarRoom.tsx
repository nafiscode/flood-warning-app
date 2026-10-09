"use client";

import { useTranslations } from "next-intl";
import { DamBoard } from "@/components/admin/DamBoard";
import { useCallback, useEffect, useRef, useState } from "react";
import { DualTime } from "@/components/admin/DualTime";
import { Tile } from "@/components/admin/WarRoomBits";
import { WarRoomCases, type CaseActions, type CasePanels } from "@/components/admin/WarRoomCases";
import { MapLegend, WarRoomMap, type MapLayerKey } from "@/components/admin/WarRoomMap";
import { WarRoomPeople } from "@/components/admin/WarRoomPeople";
import { TriangleIcon } from "@/components/icons";
import { Link } from "@/i18n/navigation";
import { hint } from "@/lib/ui";
import {
  splitMinutes,
  triage,
  type PeoplePage,
  type WarRoomBoard,
  type WarRoomMapData,
} from "@/lib/war-room";

/**
 * The admins' war room (spec 6.4): one screen for what is happening, who is waiting for help and
 * who has registered where. It is reached only from the admin console, which the route itself
 * closes to everyone else; every read and write behind it is checked again in the database.
 *
 * The board refreshes itself every 20 seconds while the tab is in front, because a case nobody
 * has answered is the one thing here that must not go stale. Everything else (the people list,
 * the map data, an open panel) is read by the page on the server when it is asked for.
 */

export type WarRoomView = "cases" | "people" | "map";

type Props = {
  initial: WarRoomBoard;
  view: WarRoomView;
  people: PeoplePage | null;
  mapData: WarRoomMapData | null;
  panels: CasePanels;
  personReveal: { userId: string; phone: string | null } | null;
  /** The page's own address, for the tabs and the panel links. Null on the example page. */
  path: string | null;
  /** Where a fresh board comes from. Null on the example page, which stays still. */
  pollUrl: string | null;
  /** The example page has no address of its own: it switches the tabs in the browser instead. */
  onView?: (view: WarRoomView) => void;
  actions: CaseActions | null;
  /** Records what an admin did about a dam release notice. Null on the example page. */
  reviewDam?: ((form: FormData) => void) | null;
  done: string | null;
  error: string | null;
};

const POLL_MS = 20_000;
const TICK_MS = 30_000;

export function WarRoom({
  initial,
  view,
  people,
  mapData,
  panels,
  personReveal,
  path,
  pollUrl,
  onView,
  actions,
  reviewDam = null,
  done,
  error,
}: Props) {
  const t = useTranslations("warRoom");
  // The board on screen is whichever is fresher: what the page was rendered with (after an
  // action or a panel) or what the last refresh brought. Deriving it needs no effect to keep the
  // two in step, and the example page, whose clock is a fixed date, simply never moves.
  const [polled, setPolled] = useState<WarRoomBoard | null>(null);
  const board = polled && polled.now > initial.now ? polled : initial;
  const [clock, setClock] = useState(initial.now);
  const now = Math.max(clock, board.now);
  const [live, setLive] = useState(true);
  const [failed, setFailed] = useState(false);
  const [layers, setLayers] = useState<MapLayerKey[]>(["cases", "density"]);
  const busy = useRef(false);

  const refresh = useCallback(async () => {
    if (!pollUrl || busy.current) return;
    busy.current = true;
    try {
      const answer = await fetch(pollUrl, { cache: "no-store" });
      if (!answer.ok) throw new Error(String(answer.status));
      const fresh = (await answer.json()) as WarRoomBoard;
      setPolled(fresh);
      setFailed(false);
    } catch {
      // Keep the numbers that are on screen and say they are standing still.
      setFailed(true);
    } finally {
      busy.current = false;
    }
  }, [pollUrl]);

  useEffect(() => {
    if (!live || !pollUrl) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, POLL_MS);
    const onShow = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onShow);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [live, pollUrl, refresh]);

  // The waiting times move on their own between polls.
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const o = board.overview;
  const bands = triage(board.cases, now, o.unclaimedMinutes);
  const open = bands.overdue.length + bands.waiting.length + bands.working.length;
  const oldest = o.oldestWaitingAt
    ? Math.max(0, Math.floor((now - Date.parse(o.oldestWaitingAt)) / 60_000))
    : 0;
  const tab = (key: WarRoomView, text: string) => {
    const className = `inline-flex min-h-tap items-center rounded-xl px-4 font-bold ${
      view === key
        ? "bg-jaga-slate text-white"
        : "border-2 border-jaga-edge bg-jaga-surface text-jaga-ink"
    }`;
    if (path) {
      return (
        <Link key={key} href={`${path}?view=${key}`} prefetch={false} className={className}>
          {text}
        </Link>
      );
    }
    if (onView) {
      return (
        <button key={key} type="button" onClick={() => onView(key)} className={className}>
          {text}
        </button>
      );
    }
    return (
      <span key={key} className={className}>
        {text}
      </span>
    );
  };

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-2">
        <h1 className="text-h3 font-bold text-jaga-ink">{t("title")}</h1>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className={hint}>
            {t("updated")}{" "}
            <DualTime iso={new Date(board.now).toISOString()} bangkokLabel={t("bangkok")} />
          </p>
          {pollUrl && (
            <button
              type="button"
              onClick={() => {
                setLive((on) => !on);
                if (!live) void refresh();
              }}
              className="inline-flex min-h-tap items-center gap-2 rounded-xl border-2 border-jaga-edge px-3 text-small font-medium text-jaga-ink"
            >
              <span
                aria-hidden="true"
                className={`inline-block size-3 rounded-full ${live ? "bg-jaga-teal-ink" : "bg-alert-stale"}`}
              />
              {live ? t("liveOn") : t("liveOff")}
            </button>
          )}
          {pollUrl && (
            <button
              type="button"
              onClick={() => void refresh()}
              className="inline-flex min-h-tap items-center rounded-xl border-2 border-jaga-edge px-3 text-small font-medium text-jaga-ink"
            >
              {t("refresh")}
            </button>
          )}
        </div>
        {failed && (
          <p
            role="status"
            className="rounded-xl border-2 border-jaga-edge bg-jaga-ground px-4 py-2 font-medium"
          >
            {t("pollFailed")}
          </p>
        )}
        {done && (
          <p
            role="status"
            className="rounded-xl border-2 border-jaga-edge bg-jaga-ground px-4 py-2 font-medium"
          >
            {t.has(`done.${done}`) ? t(`done.${done}`) : done}
          </p>
        )}
        {error && (
          <p
            role="alert"
            className="rounded-xl border-2 border-sos bg-jaga-surface px-4 py-2 font-medium"
          >
            {t.has(`error.${error}`) ? t(`error.${error}`) : error}
          </p>
        )}
      </header>

      {/* The one thing that must be seen first: cases nobody has taken. */}
      {bands.overdue.length > 0 && (
        <section className="flex flex-col gap-2 rounded-2xl border-2 border-sos bg-jaga-surface p-4">
          <h2 className="flex items-center gap-2 text-h3 font-bold text-jaga-ink">
            <span className="inline-flex items-center gap-2 rounded-xl bg-sos px-3 py-1 text-sos-fg">
              <TriangleIcon size={22} />
              {t("gate.badge")}
            </span>
          </h2>
          <p className="font-bold">
            {t("gate.count", { count: bands.overdue.length, minutes: o.unclaimedMinutes })}
          </p>
          <p>
            {oldest > 0 &&
              t("gate.oldest", {
                time:
                  splitMinutes(oldest).hours > 0
                    ? t("time.hm", splitMinutes(oldest))
                    : t("time.m", { minutes: splitMinutes(oldest).minutes }),
              })}
          </p>
          <p className={hint}>{t("gate.what")}</p>
        </section>
      )}

      {/*
        Two tiles a row on a phone, three on a tablet, all six in a line on a laptop. The three
        case counters are taken from the board itself, not from the database's own count, so the
        tiles and the bands below always say the same thing while the clock moves between polls.
      */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Tile label={t("tile.open")} value={open} note={t("tile.openNote", { count: o.sos24h })} />
        <Tile
          label={t("tile.overdue")}
          value={bands.overdue.length}
          note={t("tile.overdueNote", { minutes: o.unclaimedMinutes })}
          urgent={bands.overdue.length > 0}
        />
        <Tile
          label={t("tile.working")}
          value={bands.working.length}
          note={t("tile.workingNote", { count: o.sosClosed24h })}
        />
        <Tile
          label={t("tile.people")}
          value={o.people}
          note={t("tile.peopleNote", { count: o.peopleNew7d })}
        />
        <Tile
          label={t("tile.watched")}
          value={o.watchedPlaces}
          note={t("tile.watchedNote", { count: o.watchedNotify })}
        />
        <Tile
          label={t("tile.units")}
          value={o.unitsVerified}
          note={t("tile.unitsNote", { pending: o.unitsPending, gaps: o.tambonsUncovered })}
        />
      </section>

      {/*
       * A confirmed dam release waiting for a person to judge it. Below the unanswered cases and
       * above everything else: somebody waiting for rescue outranks it, but it is the only other
       * thing on this screen that gets worse by being seen late (spec section 15).
       */}
      <DamBoard dams={board.dams} now={now} review={reviewDam} />

      <nav aria-label={t("tabs")} className="flex flex-wrap gap-2">
        {tab("cases", t("tab.cases", { count: open }))}
        {tab("people", t("tab.people", { count: o.people }))}
        {tab("map", t("tab.map"))}
      </nav>

      {view === "cases" && (
        <WarRoomCases
          cases={board.cases}
          now={now}
          unclaimedMinutes={o.unclaimedMinutes}
          path={path}
          actions={actions}
          {...panels}
        />
      )}

      {view === "people" && people && (
        <WarRoomPeople
          page={people}
          watched={mapData?.watched ?? null}
          reveal={personReveal}
          path={path}
        />
      )}

      {view === "map" && (
        <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,3fr)_minmax(0,1fr)] lg:items-start lg:gap-6">
          <WarRoomMap
            cases={board.cases}
            data={mapData}
            now={now}
            unclaimedMinutes={o.unclaimedMinutes}
            shown={layers}
            onPick={() => {}}
            text={{ loading: t("map.loading"), failed: t("map.failed") }}
          />
          <div className="flex flex-col gap-4">
            <fieldset className="flex flex-col gap-2 rounded-2xl border border-jaga-line bg-jaga-surface p-4">
              <legend className="px-1 font-bold text-jaga-ink">{t("map.layers")}</legend>
              {(["cases", "homes", "density", "reports"] as MapLayerKey[]).map((key) => (
                <label key={key} className="flex min-h-tap items-center gap-3">
                  <input
                    type="checkbox"
                    checked={layers.includes(key)}
                    onChange={(e) =>
                      setLayers((on) =>
                        e.target.checked ? [...on, key] : on.filter((k) => k !== key),
                      )
                    }
                    className="size-6 shrink-0 accent-jaga-teal-ink"
                  />
                  <span>{t(`map.layer.${key}`)}</span>
                </label>
              ))}
            </fieldset>
            <section className="flex flex-col gap-2 rounded-2xl border border-jaga-line bg-jaga-surface p-4">
              <h2 className="font-bold text-jaga-ink">{t("map.legend")}</h2>
              <MapLegend shown={layers} />
              <p className={hint}>{t("map.privacy")}</p>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
