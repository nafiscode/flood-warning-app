"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BoardView,
  type AlarmState,
  type BoardNotice,
  type UnitActions,
} from "@/components/authority/BoardView";
import type { CaseActions } from "@/components/authority/CaseCard";
import { shouldAlarm, type AuthorityBoard } from "@/lib/dispatch";
import { arm, play } from "@/lib/sounds";

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
  };
  const unitActions: UnitActions = {
    duty: (unit, on) => send({ action: "duty", unit, on }, unit),
    sharing: (unit, on) => send({ action: "sharing", unit, on }, unit),
  };

  return (
    <BoardView
      board={board}
      now={now}
      alarm={alarm}
      onArm={onArm}
      busy={busy}
      notice={notice}
      phones={phones}
      stale={stale}
      onRefresh={refresh}
      actions={actions}
      unitActions={unitActions}
    />
  );
}
