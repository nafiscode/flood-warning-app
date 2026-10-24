"use client";

import { useEffect, useState } from "react";
import {
  BoardView,
  type AlarmState,
  type BoardNotice,
  type ConsoleView,
} from "@/components/authority/BoardView";
import type { CaseActions } from "@/components/authority/CaseCard";
import { OtherView } from "@/components/authority/OtherView";
import { TeamWarRoom } from "@/components/authority/TeamWarRoom";
import { useConsoleView } from "@/lib/console-view";
import {
  EXAMPLE_AUTHORITY_BOARD,
  EXAMPLE_COVERAGE,
  EXAMPLE_HOUSEHOLDS,
  EXAMPLE_NOW,
  EXAMPLE_POINTS,
  EXAMPLE_REPORTS,
  exampleUnits,
  applyExample,
  type ExampleTap,
} from "@/lib/authority-examples";
import type { UnitContact } from "@/lib/coverage";
import { shouldAlarm, type AuthorityBoard, type TeamRecord } from "@/lib/dispatch";
import { arm, play } from "@/lib/sounds";

const EXAMPLE_RECORD: TeamRecord[] = [
  {
    unitId: "e0000000-0000-4000-8000-000000000001",
    unitName: "ทีมกู้ภัยตัวอย่าง บานา",
    points: 58,
    cases: 4,
    members: [
      {
        userId: "u-owner",
        name: "สมชาย (เจ้าของทีม)",
        role: "owner",
        casesTaken: 1,
        rescuesReported: 1,
      },
      {
        userId: "u-boat1",
        name: "วิชัย (เรือ 1)",
        role: "field",
        casesTaken: 3,
        rescuesReported: 2,
      },
      {
        userId: "u-boat2",
        name: "มานะ (เรือ 2)",
        role: "field",
        casesTaken: 2,
        rescuesReported: 1,
      },
    ],
  },
];

/**
 * The authority console with made-up cases, for the owner to look at and to hear. It answers taps
 * by itself: accept the offered case and the card asks for an arrival estimate, hand it back and
 * it is nobody's again. The clock starts at a fixed moment and then runs, so the countdown moves
 * and the alarm stops by itself when the offer runs out. Nothing is read or written anywhere.
 */
export function AuthorityExample({
  start = EXAMPLE_AUTHORITY_BOARD,
}: { start?: AuthorityBoard } = {}) {
  const [board, setBoard] = useState(start);
  const [now, setNow] = useState(EXAMPLE_NOW);
  const [alarm, setAlarm] = useState<AlarmState>("off");
  const [notice, setNotice] = useState<BoardNotice | null>(null);
  const [phones, setPhones] = useState<Record<string, string | null>>({});
  const [media, setMedia] = useState<Record<string, "failed">>({});

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
    setNotice(
      t.action === "accept"
        ? { kind: "accepted" }
        : t.action === "complete"
          ? { kind: "completed" }
          : t.action === "confirm"
            ? { kind: "confirmed" }
            : null,
    );
    setBoard((b) => applyExample(b, t, now));
  };

  const [view, setView] = useState<ConsoleView>("cases");
  const [tambon, setTambon] = useState<string | null>(null);
  const [reportMedia, setReportMedia] = useState<Record<string, "failed">>({});
  const [householdPhones, setHouseholdPhones] = useState<Record<string, string | null>>({});
  const [contacts, setContacts] = useState<Record<string, UnitContact>>({});
  const actions: CaseActions = {
    accept: (sos) => tap({ action: "accept", sos }),
    decline: (sos, reason) => tap({ action: "decline", sos, reason }),
    eta: (sos, band) => tap({ action: "eta", sos, band }),
    advance: (sos, status) => tap({ action: "advance", sos, status }),
    release: (sos, reason) => tap({ action: "release", sos, reason }),
    // No number exists to show: the example says what the real card says when there is none.
    phone: (sos) => setPhones((seen) => ({ ...seen, [sos]: null })),
    // The photos chosen are counted and go nowhere: the example has no storage behind it.
    complete: (sos, photos) => tap({ action: "complete", sos, photos: photos.length }),
    confirm: (sos) => tap({ action: "confirm", sos }),
    media: (sos) => setMedia((seen) => ({ ...seen, [sos]: "failed" })),
    assign: (sos, userId) => tap({ action: "assign", sos, userId }),
    unassign: (assignmentId) => tap({ action: "unassign", assignmentId }),
  };

  // On a laptop or a landscape tablet the example shows the war room, as the real console does.
  const warRoom = useConsoleView();
  if (warRoom) {
    return (
      <TeamWarRoom
        board={board}
        now={now}
        alarm={alarm}
        onArm={() => void arm().then((ok) => setAlarm(ok ? "on" : "none"))}
        busy={null}
        notice={notice}
        phones={phones}
        media={media}
        stale={false}
        onRefresh={null}
        actions={actions}
        unitActions={{
          duty: (unit, on) => tap({ action: "duty", unit, on }),
          sharing: (unit, on) => tap({ action: "sharing", unit, on }),
        }}
        coverage={EXAMPLE_COVERAGE}
        record={EXAMPLE_RECORD}
        live
      />
    );
  }

  return (
    <BoardView
      board={board}
      now={now}
      alarm={alarm}
      onArm={() => void arm().then((ok) => setAlarm(ok ? "on" : "none"))}
      busy={null}
      notice={notice}
      phones={phones}
      media={media}
      stale={false}
      onRefresh={null}
      actions={actions}
      unitActions={{
        duty: (unit, on) => tap({ action: "duty", unit, on }),
        sharing: (unit, on) => tap({ action: "sharing", unit, on }),
      }}
      view={view}
      onView={setView}
      other={
        view !== "cases" && (
          <OtherView
            view={view}
            cases={board.cases}
            now={now}
            busy={null}
            phones={phones}
            media={media}
            actions={actions}
            coverage={EXAMPLE_COVERAGE}
            points={EXAMPLE_POINTS}
            picked={tambon ? { tambon, units: exampleUnits(tambon) } : null}
            onPickTambon={setTambon}
            reads={{
              reports: EXAMPLE_REPORTS,
              households: EXAMPLE_HOUSEHOLDS,
              reportMedia,
              householdPhones,
              // The example has no storage and no numbers: it shows what the real screen says then.
              onReportMedia: (id) => setReportMedia((seen) => ({ ...seen, [id]: "failed" })),
              onHouseholdPhone: (id) => setHouseholdPhones((seen) => ({ ...seen, [id]: null })),
              contacts,
              onContact: (id) =>
                setContacts((seen) => ({ ...seen, [id]: { name: null, phone: null } })),
            }}
          />
        )
      }
    />
  );
}
