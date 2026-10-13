"use client";

import { PushCard } from "@/components/push/PushCard";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  BoardView,
  type AlarmState,
  type BoardNotice,
  type ConsoleView,
  type UnitActions,
} from "@/components/authority/BoardView";
import type { CaseActions } from "@/components/authority/CaseCard";
import { OtherView } from "@/components/authority/OtherView";
import type {
  CoverageRow,
  CoverageUnit,
  PointsRow,
  TeamHousehold,
  TeamReport,
  UnitContact,
} from "@/lib/coverage";
import { shouldAlarm, supplyOffers, type AuthorityBoard, type CaseMedia } from "@/lib/dispatch";
import { arm, play } from "@/lib/sounds";
import { uploadProof } from "@/lib/upload";

/**
 * The authority console, live (spec 5.1, 5.2): it keeps the board fresh, carries every tap to the
 * server, and rings while a case is being offered to this team.
 *
 * Nothing is pushed to it. Who holds an offer is worked out by the database from the clock on
 * every read, so the console simply asks again every few seconds while it is in front, and counts
 * the seconds down in between against the server's clock rather than the phone's own.
 *
 * The alarm needs one tap first (browsers play nothing before one), and it only sounds while this
 * page is open: the words on the screen say so. It stops the moment the offer is answered, passes
 * on, or runs out.
 */

const POLL_MS = 8_000;
const TICK_MS = 1_000;

type Answer = {
  board?: AuthorityBoard | null;
  taken?: boolean;
  byUnitName?: string | null;
  phone?: string | null;
  media?: CaseMedia;
  error?: string;
};

export function Console({ initial }: { initial: AuthorityBoard }) {
  const [polled, setPolled] = useState<AuthorityBoard | null>(null);
  const board = polled && polled.readAt > initial.readAt ? polled : initial;
  const [now, setNow] = useState(() => Date.parse(initial.readAt));
  const [alarm, setAlarm] = useState<AlarmState>("off");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<BoardNotice | null>(null);
  const [phones, setPhones] = useState<Record<string, string | null>>({});
  const [media, setMedia] = useState<Record<string, CaseMedia | "failed">>({});
  const [stale, setStale] = useState(false);
  // How far the server's clock is ahead of this phone's, from the last answer that came back.
  const skew = useRef(0);
  const asking = useRef(false);
  // Moves on whenever a tap is sent and again when its answer is back. A refresh that set out
  // under an older number is dropped: it read the board before the tap and would put the old
  // state back on screen - an accepted case would look unaccepted until the next refresh.
  const epoch = useRef(0);

  const take = useCallback((fresh: AuthorityBoard) => {
    skew.current = Date.parse(fresh.readAt) - Date.now();
    setPolled(fresh);
    setNow(Date.parse(fresh.readAt));
    setStale(false);
  }, []);

  // Not an async function: the state is set in the promise's callbacks, never while an effect
  // is running (the same shape as the requester's own status screen).
  const refresh = useCallback(() => {
    if (asking.current) return;
    asking.current = true;
    const started = epoch.current;
    fetch("/api/authority/board", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        return (await response.json()) as AuthorityBoard;
      })
      .then(
        (fresh) => {
          if (started === epoch.current) take(fresh);
        },
        () => setStale(true),
      )
      .finally(() => {
        asking.current = false;
      });
  }, [take]);

  useEffect(() => {
    refresh();
    const poll = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, POLL_MS);
    const tick = window.setInterval(() => setNow(Date.now() + skew.current), TICK_MS);
    const again = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", again);
    window.addEventListener("online", again);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(tick);
      document.removeEventListener("visibilitychange", again);
      window.removeEventListener("online", again);
    };
  }, [refresh]);

  // The alarm: on while an offer to this team has time left, off the moment it has not.
  const ringing = alarm === "on" && shouldAlarm(board.cases, now);
  useEffect(() => {
    if (!ringing) return;
    const playing = play("offer");
    return () => playing.stop();
  }, [ringing]);

  // A request for food and water never rings the alarm: one soft sound when it is first offered
  // to this team, and then only the card (decision of 13 October).
  const supplyKey = supplyOffers(board.cases, now).join(",");
  const announced = useRef(new Set<string>());
  useEffect(() => {
    if (alarm !== "on" || supplyKey === "") return;
    const fresh = supplyKey.split(",").filter((id) => !announced.current.has(id));
    if (fresh.length === 0) return;
    for (const id of fresh) announced.current.add(id);
    play("supplyOffer");
  }, [alarm, supplyKey]);

  const onArm = useCallback(() => {
    void arm().then((ok) => setAlarm(ok ? "on" : "none"));
  }, []);

  const send = useCallback(
    (body: Record<string, unknown>, key: string, after?: (answer: Answer) => void) => {
      setBusy(key);
      setNotice(null);
      epoch.current += 1;
      fetch("/api/authority/act", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
      })
        .then(async (response) => {
          const answer = (await response.json().catch(() => ({}))) as Answer;
          epoch.current += 1;
          if (!response.ok) {
            if (body.action === "media") {
              setMedia((seen) => ({ ...seen, [key]: "failed" }));
              return;
            }
            setNotice({ kind: "refused" });
            refresh();
            return;
          }
          if (answer.board) take(answer.board);
          after?.(answer);
        })
        .catch(() => setNotice({ kind: "failed" }))
        .finally(() => setBusy(null));
    },
    [refresh, take],
  );

  /**
   * A rescue report or a fallback confirmation: the photos go from this phone straight into the
   * private bucket, then the report names them. If no photo arrives nothing is reported - the
   * database would refuse it anyway, and the crew is told to try again.
   */
  const finish = (kind: "complete" | "confirm", sos: string, photos: File[], note: string) => {
    setBusy(sos);
    setNotice(null);
    uploadProof(sos, photos).then(
      (sent) => {
        if (sent.photos.length === 0) {
          setBusy(null);
          setNotice({ kind: "upload" });
          return;
        }
        send({ action: kind, sos, photos: sent.photos, note }, sos, () =>
          setNotice({ kind: kind === "complete" ? "completed" : "confirmed" }),
        );
      },
      () => {
        setBusy(null);
        setNotice({ kind: "upload" });
      },
    );
  };

  const actions: CaseActions = {
    accept: (sos) =>
      send({ action: "accept", sos }, sos, (answer) =>
        setNotice(
          answer.taken ? { kind: "taken", unit: answer.byUnitName ?? null } : { kind: "accepted" },
        ),
      ),
    decline: (sos, reason) => send({ action: "decline", sos, reason }, sos),
    eta: (sos, band) => send({ action: "eta", sos, band }, sos),
    advance: (sos, status) => send({ action: "advance", sos, status }, sos),
    release: (sos, reason) => send({ action: "release", sos, reason }, sos),
    phone: (sos) =>
      send({ action: "phone", sos }, sos, (answer) =>
        setPhones((seen) => ({ ...seen, [sos]: answer.phone ?? null })),
      ),
    complete: (sos, photos, note) => finish("complete", sos, photos, note),
    confirm: (sos, photos, note) => finish("confirm", sos, photos, note),
    media: (sos) =>
      send({ action: "media", sos }, sos, (answer) =>
        setMedia((seen) => ({
          ...seen,
          [sos]: answer.media ?? { photos: [], voice: null, proof: [] },
        })),
      ),
  };
  // The other views read their own data, and only when somebody opens them.
  const [view, setView] = useState<ConsoleView>("cases");
  const [coverage, setCoverage] = useState<CoverageRow[] | "failed" | null>(null);
  const [points, setPoints] = useState<PointsRow[] | "failed" | null>(null);
  const [picked, setPicked] = useState<{
    tambon: string;
    units: CoverageUnit[] | "failed" | null;
  } | null>(null);

  const ask = <T,>(query: string, take: (answer: T) => void, fail: () => void) => {
    fetch(`/api/authority/extra?${query}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        return (await response.json()) as T;
      })
      .then(take, fail);
  };

  const [reports, setReports] = useState<TeamReport[] | "failed" | null>(null);
  const [households, setHouseholds] = useState<TeamHousehold[] | "failed" | null>(null);
  const [reportMedia, setReportMedia] = useState<Record<string, CaseMedia | "failed">>({});
  const [householdPhones, setHouseholdPhones] = useState<Record<string, string | null>>({});
  const [contacts, setContacts] = useState<Record<string, UnitContact | "failed">>({});

  /** One household's number or one report's photos: asked for by a tap, never with the list. */
  const one = <T,>(body: Record<string, unknown>, take: (answer: T) => void, fail: () => void) => {
    fetch("/api/authority/act", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        return (await response.json()) as T;
      })
      .then(take, fail);
  };

  const openView = (next: ConsoleView) => {
    setView(next);
    // Reports move with the water: read each time the tab is opened.
    if (next === "reports") {
      ask<{ reports: TeamReport[] }>(
        "what=reports",
        (answer) => setReports(answer.reports),
        () => setReports("failed"),
      );
    }
    // Every read of the households is written to the access log, so it is read once a sitting
    // and not again each time the tab is tapped.
    if (next === "households" && !Array.isArray(households)) {
      ask<{ households: TeamHousehold[] }>(
        "what=households",
        (answer) => setHouseholds(answer.households),
        () => setHouseholds("failed"),
      );
    }
    // Coverage changes when a team is verified, which is rare: read once a sitting.
    if ((next === "map" || next === "coverage") && !Array.isArray(coverage)) {
      ask<{ coverage: CoverageRow[] }>(
        "what=coverage",
        (answer) => setCoverage(answer.coverage),
        () => setCoverage("failed"),
      );
    }
    // Points move with every confirmation: read each time the tab is opened.
    if (next === "points") {
      ask<{ points: PointsRow[] }>(
        "what=points",
        (answer) => setPoints(answer.points),
        () => setPoints("failed"),
      );
    }
  };

  const pickTambon = (tambon: string) => {
    setPicked({ tambon, units: null });
    ask<{ tambon: string; units: CoverageUnit[] }>(
      `what=units&tambon=${encodeURIComponent(tambon)}`,
      (answer) =>
        setPicked((now) => (now?.tambon === answer.tambon ? { ...now, units: answer.units } : now)),
      () => setPicked((now) => (now?.tambon === tambon ? { ...now, units: "failed" } : now)),
    );
  };

  const unitActions: UnitActions = {
    duty: (unit, on) => send({ action: "duty", unit, on }, unit),
    sharing: (unit, on) => send({ action: "sharing", unit, on }, unit),
  };

  return (
    <>
      {/* The offer reaches this phone with the board closed once notifications are on (A7). */}
      <PushCard place="team" />
      <BoardView
        board={board}
        now={now}
        alarm={alarm}
        onArm={onArm}
        busy={busy}
        notice={notice}
        phones={phones}
        media={media}
        stale={stale}
        onRefresh={refresh}
        actions={actions}
        unitActions={unitActions}
        view={view}
        onView={openView}
        other={
          view !== "cases" && (
            <OtherView
              view={view}
              cases={board.cases}
              now={now}
              busy={busy}
              phones={phones}
              media={media}
              actions={actions}
              coverage={coverage}
              points={points}
              picked={picked}
              onPickTambon={pickTambon}
              reads={{
                reports,
                households,
                reportMedia,
                householdPhones,
                onReportMedia: (id) =>
                  one<{ media: CaseMedia }>(
                    { action: "report_media", id },
                    (answer) => setReportMedia((seen) => ({ ...seen, [id]: answer.media })),
                    () => setReportMedia((seen) => ({ ...seen, [id]: "failed" })),
                  ),
                onHouseholdPhone: (id) =>
                  one<{ phone: string | null }>(
                    { action: "household_phone", id },
                    (answer) => setHouseholdPhones((seen) => ({ ...seen, [id]: answer.phone })),
                    () => setHouseholdPhones((seen) => ({ ...seen, [id]: null })),
                  ),
                contacts,
                onContact: (id) =>
                  one<{ contact: UnitContact }>(
                    { action: "unit_phone", unit: id },
                    (answer) => setContacts((seen) => ({ ...seen, [id]: answer.contact })),
                    () => setContacts((seen) => ({ ...seen, [id]: "failed" })),
                  ),
              }}
            />
          )
        }
      />
    </>
  );
}
