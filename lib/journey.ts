import type { MyReport } from "@/lib/flood-reports";
import type { SosTimeline, TimelineEntry } from "@/lib/sos";

/**
 * The journey of a request (the owner, 13 Oct): every thing a person sends to Jaga that somebody
 * else then acts on - a request for help, a request for food and water, a team's registration, a
 * flood report - shown as the same short line of steps, so they can see where it stands without
 * having to ask.
 *
 * Pure: it turns what the app already knows into steps. Nothing here talks to the server, and no
 * step is ever invented - a step is done only when the record says so, and a step that has not
 * happened carries no time (safety rule 8: never present a guess as a fact).
 */

export type StepState = "done" | "now" | "todo" | "stopped";

export type JourneyStep = {
  /** The message key under `journey.<kind>.steps`. */
  key: string;
  state: StepState;
  /** When it happened, if it has. */
  at: string | null;
  /** A name to put in the step's words: the team that accepted. */
  name?: string | null;
  /** Words somebody wrote about this step: the reason a registration was turned down. */
  note?: string | null;
};

export type JourneyKind = "rescue" | "supplies" | "unit" | "report" | "field";

export type Journey = {
  kind: JourneyKind;
  steps: JourneyStep[];
  /** False once nothing more will happen to it. */
  open: boolean;
};

const latest = (events: readonly TimelineEntry[], ...names: string[]): TimelineEntry | null => {
  let found: TimelineEntry | null = null;
  for (const e of events) {
    if (names.includes(e.event) && (!found || Date.parse(e.at) >= Date.parse(found.at))) found = e;
  }
  return found;
};

/** The steps a request for help or for supplies goes through, in order. */
const SOS_STEPS = ["sent", "accepted", "en_route", "on_site", "finished", "confirmed"] as const;

/** How far along each status is: the index of the step being waited for. */
const WAITING_FOR: Record<string, number> = {
  received: 1,
  assigned: 2,
  en_route: 3,
  on_site: 4,
  rescued: 5,
};

/**
 * A request for help, or for food and water. Sent, a team accepts, sets out, arrives, reports it
 * done, and the sender confirms. A team that hands the case back puts it back at "looking for a
 * team"; a sender who says they are safe, or an admin who closes it, ends it where it stood.
 */
export function sosJourney(timeline: SosTimeline): Journey {
  const kind: JourneyKind = timeline.kind === "supplies" ? "supplies" : "rescue";
  const events = timeline.events;
  // Only what happened since the last hand-back counts towards the team's steps.
  const released = latest(events, "released", "released_by_admin", "not_rescued");
  const since = released ? Date.parse(released.at) : 0;
  const after = (...names: string[]) => {
    const e = latest(events, ...names);
    return e && Date.parse(e.at) >= since ? e : null;
  };
  const accepted = after("accepted", "assigned_by_admin");
  const times: (string | null)[] = [
    timeline.createdAt,
    accepted?.at ?? null,
    after("en_route")?.at ?? null,
    after("on_site")?.at ?? null,
    after("rescued_by_team", "rescued")?.at ?? null,
    after("confirmed")?.at ?? timeline.closedAt,
  ];
  const team = timeline.team && !timeline.team.searching ? timeline.team.unitName : null;
  const name = accepted?.unit ?? team ?? timeline.unitName;

  if (timeline.status === "safe_cancelled" || timeline.status === "dismissed") {
    // Ended early: show what was reached, then how it ended. Steps never reached are left out
    // rather than shown as skipped.
    const reached = SOS_STEPS.slice(0, 5)
      .map((key, i) => ({ key, at: times[i] ?? null }))
      .filter((s, i) => i === 0 || s.at !== null);
    const end = latest(events, timeline.status);
    return {
      kind,
      open: false,
      steps: [
        ...reached.map((s) => ({ ...s, state: "done" as const, name })),
        {
          key: timeline.status,
          state: timeline.status === "dismissed" ? ("stopped" as const) : ("done" as const),
          at: end?.at ?? timeline.closedAt,
        },
      ],
    };
  }

  const closed = timeline.status === "rescued" && timeline.closedAt !== null;
  const waiting = closed ? SOS_STEPS.length : (WAITING_FOR[timeline.status] ?? 1);
  return {
    kind,
    open: !closed,
    steps: SOS_STEPS.map((key, i) => ({
      key,
      state: i < waiting ? "done" : i === waiting ? "now" : "todo",
      // A step still to come has no time, whatever an earlier round left in the record.
      at: i < waiting ? (times[i] ?? null) : null,
      name: i >= 1 && i <= 3 ? name : null,
    })),
  };
}

export type UnitRequest = {
  id: string;
  name: string;
  status: "pending" | "verified" | "rejected" | "suspended";
  createdAt: string;
  verifiedAt: string | null;
  updatedAt: string | null;
  /** Why an admin turned the registration down, in their own words. Rejected units only. */
  reviewNote?: string | null;
};

/** A team's registration: sent, checked by an admin (who calls the official phone), verified. */
export function unitJourney(unit: UnitRequest): Journey {
  const sent: JourneyStep = { key: "sent", state: "done", at: unit.createdAt };
  if (unit.status === "pending") {
    return {
      kind: "unit",
      open: true,
      steps: [
        sent,
        { key: "review", state: "now", at: null },
        { key: "verified", state: "todo", at: null },
      ],
    };
  }
  const reviewed: JourneyStep = { key: "review", state: "done", at: null };
  if (unit.status === "verified") {
    return {
      kind: "unit",
      open: false,
      steps: [sent, reviewed, { key: "verified", state: "done", at: unit.verifiedAt }],
    };
  }
  // Turned down by an admin: the reason they wrote stands on the step (owner, 16 Oct).
  if (unit.status === "rejected") {
    return {
      kind: "unit",
      open: false,
      steps: [
        sent,
        reviewed,
        { key: "rejected", state: "stopped", at: unit.updatedAt, note: unit.reviewNote ?? null },
      ],
    };
  }
  return {
    kind: "unit",
    open: false,
    steps: [sent, reviewed, { key: "suspended", state: "stopped", at: unit.updatedAt }],
  };
}

/** A flood report: sent, shown to the neighbours while it stands, then how it ended. */
export function reportJourney(report: MyReport): Journey {
  const sent: JourneyStep = { key: "sent", state: "done", at: report.createdAt };
  if (report.state === "standing") {
    return {
      kind: "report",
      open: true,
      steps: [
        sent,
        { key: "standing", state: "now", at: null },
        { key: "ended", state: "todo", at: null },
      ],
    };
  }
  if (report.state === "hidden") {
    return {
      kind: "report",
      open: false,
      steps: [sent, { key: "hidden", state: "stopped", at: null }],
    };
  }
  return {
    kind: "report",
    open: false,
    steps: [
      sent,
      { key: "standing", state: "done", at: null },
      { key: report.state, state: "done", at: null },
    ],
  };
}

/** The step a card can say in one line: the one being waited for, else the last one. */
export function currentStep(journey: Journey): JourneyStep {
  return journey.steps.find((s) => s.state === "now") ?? journey.steps[journey.steps.length - 1]!;
}

/** "3 of 6": how many steps are behind them. */
export function progress(journey: Journey): { done: number; of: number } {
  return {
    done: journey.steps.filter((s) => s.state === "done").length,
    of: journey.steps.length,
  };
}

export function toUnitRequest(row: Record<string, unknown>): UnitRequest | null {
  const status = row.status;
  if (
    typeof row.id !== "string" ||
    typeof row.created_at !== "string" ||
    (status !== "pending" &&
      status !== "verified" &&
      status !== "rejected" &&
      status !== "suspended")
  )
    return null;
  return {
    id: row.id,
    name: typeof row.unit_name === "string" ? row.unit_name : "",
    status,
    createdAt: row.created_at,
    verifiedAt: typeof row.verified_at === "string" ? row.verified_at : null,
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : null,
    reviewNote: typeof row.review_note === "string" && row.review_note ? row.review_note : null,
  };
}

/** Bell news about a team's registration: only the steps somebody else took. */
export function unitNews(
  unit: UnitRequest,
): { id: string; event: "verified" | "rejected" | "suspended"; at: string } | null {
  if (unit.status === "pending") return null;
  const at = unit.status === "verified" ? unit.verifiedAt : unit.updatedAt;
  if (!at) return null;
  return { id: `unit:${unit.id}:${unit.status}:${at}`, event: unit.status, at };
}

/** For an admin: field rescues waiting to be checked, and the newest of them. */
export type FieldWaiting = { count: number; newestId: string; newestAt: string };

export const REQUESTS_URL = "/api/me/requests";
