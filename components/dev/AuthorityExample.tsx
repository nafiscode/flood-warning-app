"use client";

import { useEffect, useState } from "react";
import { BoardView, type AlarmState, type BoardNotice } from "@/components/authority/BoardView";
import {
  EXAMPLE_AUTHORITY_BOARD,
  EXAMPLE_NOW,
  applyExample,
  type ExampleTap,
} from "@/lib/authority-examples";
import { shouldAlarm } from "@/lib/dispatch";
import { arm, play } from "@/lib/sounds";

/**
 * The authority console with made-up cases, for the owner to look at and to hear. It answers taps
 * by itself: accept the offered case and the card asks for an arrival estimate, hand it back and
 * it is nobody's again. The clock starts at a fixed moment and then runs, so the countdown moves
 * and the alarm stops by itself when the offer runs out. Nothing is read or written anywhere.
 */
export function AuthorityExample() {
  const [board, setBoard] = useState(EXAMPLE_AUTHORITY_BOARD);
  const [now, setNow] = useState(EXAMPLE_NOW);
  const [alarm, setAlarm] = useState<AlarmState>("off");
  const [notice, setNotice] = useState<BoardNotice | null>(null);
  const [phones, setPhones] = useState<Record<string, string | null>>({});

  useEffect(() => {
    const timer = window.setInterval(() => setNow((t) => t + 1000), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const ringing = alarm === "on" && shouldAlarm(board.cases, now);
  useEffect(() => {
    if (!ringing) return;
    const playing = play("offer");
    return () => playing.stop();
  }, [ringing]);

  const tap = (t: ExampleTap) => {
    setNotice(t.action === "accept" ? { kind: "accepted" } : null);
    setBoard((b) => applyExample(b, t, now));
  };

  return (
    <BoardView
      board={board}
      now={now}
      alarm={alarm}
      onArm={() => void arm().then((ok) => setAlarm(ok ? "on" : "none"))}
      busy={null}
      notice={notice}
      phones={phones}
      stale={false}
      onRefresh={null}
      actions={{
        accept: (sos) => tap({ action: "accept", sos }),
        decline: (sos, reason) => tap({ action: "decline", sos, reason }),
        eta: (sos, band) => tap({ action: "eta", sos, band }),
        advance: (sos, status) => tap({ action: "advance", sos, status }),
        release: (sos, reason) => tap({ action: "release", sos, reason }),
        // No number exists to show: the example says what the real card says when there is none.
        phone: (sos) => setPhones((seen) => ({ ...seen, [sos]: null })),
      }}
      unitActions={{
        duty: (unit, on) => tap({ action: "duty", unit, on }),
        sharing: (unit, on) => tap({ action: "sharing", unit, on }),
      }}
    />
  );
}
