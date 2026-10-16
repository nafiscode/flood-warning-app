import { describe, expect, it } from "vitest";
import { Journey } from "@/components/journey/Journey";
import { MyRequestsView } from "@/components/journey/MyRequests";
import { NoticeList } from "@/components/notices/NoticeList";
import type { MyReport } from "@/lib/flood-reports";
import {
  currentStep,
  progress,
  reportJourney,
  sosJourney,
  toUnitRequest,
  unitJourney,
  unitNews,
  type UnitRequest,
} from "@/lib/journey";
import { buildNotices, SOS_NEWS } from "@/lib/notices";
import type { SosTimeline, TimelineEntry } from "@/lib/sos";
import en from "@/messages/en.json";
import ms from "@/messages/ms.json";
import th from "@/messages/th.json";
import { renderWithIntl } from "./render";

const T0 = Date.parse("2026-11-20T01:00:00Z");
const at = (minutes: number) => new Date(T0 + minutes * 60_000).toISOString();
const ev = (event: string, minutes: number, unit: string | null = null): TimelineEntry => ({
  event,
  at: at(minutes),
  note: null,
  unit,
});

function timeline(over: Partial<SosTimeline> = {}): SosTimeline {
  return {
    status: "received",
    createdAt: at(0),
    closedAt: null,
    hazardType: "flood",
    lat: null,
    lon: null,
    hasPhone: false,
    unitName: null,
    orgName: null,
    photos: 0,
    hasVoice: false,
    events: [ev("received", 0)],
    team: null,
    kind: "rescue",
    needs: [],
    needsNote: null,
    suppliesLeft: null,
    ...over,
  } as SosTimeline;
}

const states = (t: SosTimeline) => sosJourney(t).steps.map((s) => `${s.key}:${s.state}`);

describe("the journey of a request for help", () => {
  it("starts with the request sent and a team being looked for", () => {
    const j = sosJourney(timeline());
    expect(states(timeline())).toEqual([
      "sent:done",
      "accepted:now",
      "en_route:todo",
      "on_site:todo",
      "finished:todo",
      "confirmed:todo",
    ]);
    expect(j.open).toBe(true);
    expect(j.steps[0]!.at).toBe(at(0));
    // A step that has not happened never carries a time.
    expect(j.steps.slice(1).every((s) => s.at === null)).toBe(true);
    expect(currentStep(j).key).toBe("accepted");
    expect(progress(j)).toEqual({ done: 1, of: 6 });
  });

  it("moves one step at a time, each with the time it happened and the team's name", () => {
    const events = [
      ev("received", 0),
      ev("accepted", 4, "Boat team A"),
      ev("en_route", 9),
      ev("on_site", 31),
    ];
    const accepted = sosJourney(timeline({ status: "assigned", events: events.slice(0, 2) }));
    expect(currentStep(accepted).key).toBe("en_route");
    expect(accepted.steps[1]).toMatchObject({ state: "done", at: at(4), name: "Boat team A" });

    const there = sosJourney(timeline({ status: "on_site", events }));
    expect(there.steps.map((s) => s.state)).toEqual([
      "done",
      "done",
      "done",
      "done",
      "now",
      "todo",
    ]);
    expect(there.steps[3]!.at).toBe(at(31));
  });

  it("waits for the sender's own confirmation after the team reports it done", () => {
    const events = [
      ev("received", 0),
      ev("accepted", 4),
      ev("en_route", 9),
      ev("on_site", 31),
      ev("rescued_by_team", 50),
    ];
    const waiting = sosJourney(timeline({ status: "rescued", events }));
    expect(currentStep(waiting).key).toBe("confirmed");
    expect(waiting.open).toBe(true);

    const done = sosJourney(
      timeline({ status: "rescued", closedAt: at(55), events: [...events, ev("confirmed", 55)] }),
    );
    expect(done.open).toBe(false);
    expect(done.steps.every((s) => s.state === "done")).toBe(true);
    expect(done.steps[5]!.at).toBe(at(55));
  });

  it("goes back to looking for a team when the team hands the case back", () => {
    const j = sosJourney(
      timeline({
        status: "received",
        events: [ev("received", 0), ev("accepted", 4, "Boat team A"), ev("released", 12)],
      }),
    );
    expect(currentStep(j).key).toBe("accepted");
    // The first team's acceptance is not shown as if it still stood.
    expect(j.steps[1]!.at).toBeNull();
    expect(j.steps[1]!.name).toBeNull();
  });

  it("ends where it stood when the sender says they are safe, or an admin closes it", () => {
    const safe = sosJourney(
      timeline({
        status: "safe_cancelled",
        closedAt: at(20),
        events: [ev("received", 0), ev("accepted", 4), ev("safe_cancelled", 20)],
      }),
    );
    expect(safe.steps.map((s) => `${s.key}:${s.state}`)).toEqual([
      "sent:done",
      "accepted:done",
      "safe_cancelled:done",
    ]);
    expect(safe.open).toBe(false);

    const closed = sosJourney(timeline({ status: "dismissed", closedAt: at(30) }));
    expect(closed.steps.map((s) => `${s.key}:${s.state}`)).toEqual([
      "sent:done",
      "dismissed:stopped",
    ]);
  });

  it("uses the supplies wording for a request for food and water", () => {
    expect(sosJourney(timeline({ kind: "supplies" })).kind).toBe("supplies");
  });
});

const unit = (over: Partial<UnitRequest> = {}): UnitRequest => ({
  id: "u1",
  name: "Yala boat team",
  status: "pending",
  createdAt: at(0),
  verifiedAt: null,
  updatedAt: at(0),
  ...over,
});

describe("the journey of a team's registration", () => {
  it("waits on the admins' check, then is verified, or says it was suspended", () => {
    expect(unitJourney(unit()).steps.map((s) => `${s.key}:${s.state}`)).toEqual([
      "sent:done",
      "review:now",
      "verified:todo",
    ]);
    const ok = unitJourney(unit({ status: "verified", verifiedAt: at(90) }));
    expect(ok.open).toBe(false);
    expect(ok.steps[2]).toMatchObject({ key: "verified", state: "done", at: at(90) });
    expect(unitJourney(unit({ status: "suspended" })).steps[2]).toMatchObject({
      key: "suspended",
      state: "stopped",
    });
  });

  it("says it was turned down, and carries the reason an admin wrote", () => {
    const no = unitJourney(unit({ status: "rejected", reviewNote: "Looks like a test." }));
    expect(no.open).toBe(false);
    expect(no.steps.map((s) => `${s.key}:${s.state}`)).toEqual([
      "sent:done",
      "review:done",
      "rejected:stopped",
    ]);
    expect(no.steps[2]).toMatchObject({ note: "Looks like a test.", at: at(0) });
    // No reason, no note: the step never invents words.
    expect(unitJourney(unit({ status: "rejected" })).steps[2]!.note).toBeNull();
  });

  it("is news only for the steps somebody else took", () => {
    expect(unitNews(unit())).toBeNull();
    expect(unitNews(unit({ status: "verified", verifiedAt: at(90) }))).toEqual({
      id: `unit:u1:verified:${at(90)}`,
      event: "verified",
      at: at(90),
    });
    expect(unitNews(unit({ status: "rejected", updatedAt: at(90) }))).toEqual({
      id: `unit:u1:rejected:${at(90)}`,
      event: "rejected",
      at: at(90),
    });
  });

  it("reads a database row, and refuses one it does not understand", () => {
    expect(
      toUnitRequest({ id: "u1", unit_name: "A", status: "verified", created_at: at(0) }),
    ).toMatchObject({ name: "A", status: "verified", verifiedAt: null });
    expect(toUnitRequest({ id: "u1", status: "banned", created_at: at(0) })).toBeNull();
    expect(
      toUnitRequest({
        id: "u1",
        unit_name: "A",
        status: "rejected",
        created_at: at(0),
        review_note: "Not a real unit.",
      }),
    ).toMatchObject({ status: "rejected", reviewNote: "Not a real unit." });
  });
});

const report = (state: MyReport["state"]): MyReport => ({
  id: "r1",
  tambon: "950101",
  nameTh: "สะเตง",
  nameEn: "Sateng",
  depth: "knee",
  createdAt: at(0),
  state,
});

describe("the journey of a flood report", () => {
  it("stands until it ends, and says how it ended", () => {
    expect(currentStep(reportJourney(report("standing"))).key).toBe("standing");
    for (const end of ["ended", "cleared", "expired"] as const) {
      const j = reportJourney(report(end));
      expect(j.open).toBe(false);
      expect(j.steps[j.steps.length - 1]!.key).toBe(end);
    }
    expect(reportJourney(report("hidden")).steps[1]).toMatchObject({
      key: "hidden",
      state: "stopped",
    });
  });
});

describe("the line of steps on the screen", () => {
  it("says each step's state in words, marks the current one, and explains what is awaited", () => {
    const { container } = renderWithIntl(
      <Journey
        journey={sosJourney(
          timeline({
            status: "assigned",
            events: [ev("received", 0), ev("accepted", 4, "Team A")],
          }),
        )}
      />,
      "en",
    );
    const steps = [...container.querySelectorAll("[data-step]")];
    expect(steps.map((s) => s.getAttribute("data-step-state"))).toEqual([
      "done",
      "done",
      "now",
      "todo",
      "todo",
      "todo",
    ]);
    expect(steps[1]!.textContent).toContain("Team A accepted the request");
    expect(steps[2]!.getAttribute("aria-current")).toBe("step");
    expect(steps[2]!.textContent).toContain(en.journey.now);
    expect(steps[2]!.textContent).toContain(en.journey.rescue.wait.en_route);
    // Never colour alone: every step carries its state as text for a screen reader.
    expect(steps.every((s) => s.querySelector(".sr-only"))).toBe(true);
    // Progress is not a level: no alert colour anywhere in it.
    expect(container.innerHTML).not.toMatch(/bg-alert-|bg-sos|text-alert-/);
  });

  it("names 'a team' when the record does not say which", () => {
    const { container } = renderWithIntl(<Journey journey={sosJourney(timeline())} />, "en");
    expect(container.querySelector('[data-step="accepted"]')!.textContent).toContain(
      "A team accepted the request",
    );
  });
});

describe("the My requests page", () => {
  const data = {
    cases: [
      { id: "c-old", timeline: timeline({ status: "safe_cancelled", closedAt: at(5) }) },
      { id: "c-open", timeline: timeline({ kind: "supplies" }) },
      { id: "c-unread", timeline: null },
    ],
    units: [unit()],
    reports: [report("standing")],
    signedIn: true,
  };

  it("lists every kind of request with its steps, the ones in progress first", () => {
    const { container } = renderWithIntl(<MyRequestsView data={data} loading={false} />, "en");
    const cards = [...container.querySelectorAll("[data-request]")];
    expect(cards.map((c) => c.getAttribute("data-request"))).toContain("unit:u1");
    expect(cards.map((c) => c.getAttribute("data-request-open"))).toEqual([
      "true",
      "true",
      "true",
      "false",
    ]);
    expect(cards.every((c) => c.querySelector("[data-journey]"))).toBe(true);
    expect(container.querySelector('[data-request="sos:c-open"] a')!.getAttribute("href")).toBe(
      "/en/sos/c-open",
    );
    expect(container.textContent).toContain("1 request could not be read");
  });

  it("says so when there is nothing, and tells a visitor what signing in adds", () => {
    const { container } = renderWithIntl(
      <MyRequestsView
        data={{ cases: [], units: [], reports: [], signedIn: false }}
        loading={false}
      />,
      "en",
    );
    expect(container.querySelector("[data-requests-empty]")).not.toBeNull();
    expect(container.textContent).toContain(en.journey.page.signInNote);
  });
});

describe("the bell, as each step is completed", () => {
  const build = (cases: Parameters<typeof buildNotices>[0]["cases"], units: UnitRequest[] = []) =>
    buildNotices({
      rows: [],
      area: null,
      me: null,
      cases,
      units,
      now: T0 + 3 * 3_600_000,
      homeLabel: "home",
      areaLabel: () => "area",
    });

  it("has an item for every step a team or an admin takes, and none for the sender's own", () => {
    const items = build([
      {
        id: "c1",
        timeline: timeline({
          status: "rescued",
          events: [
            ev("received", 0),
            ev("details_added", 1),
            ev("accepted", 4, "Team A"),
            ev("en_route", 9),
            ev("on_site", 31),
            ev("rescued_by_team", 50),
          ],
        }),
      },
    ]);
    expect(items.map((i) => (i.kind === "sos" ? i.event : i.kind))).toEqual([
      "rescued_by_team",
      "on_site",
      "en_route",
      "accepted",
    ]);
    expect(SOS_NEWS).not.toContain("received");
    expect(SOS_NEWS).not.toContain("safe_cancelled");
  });

  it("words a request for food and water as a delivery, not a rescue", () => {
    const items = build([
      {
        id: "c2",
        timeline: timeline({ kind: "supplies", events: [ev("received", 0), ev("en_route", 9)] }),
      },
    ]);
    const { container } = renderWithIntl(
      <ul>
        <NoticeList items={items} read={[]} locale="en" emptyHint="" />
      </ul>,
      "en",
    );
    expect(container.textContent).toContain(en.notices.supply.en_route);
    expect(container.textContent).toContain(en.notices.supply.title);
    expect(container.textContent).not.toContain(en.notices.sos.en_route);
  });

  it("tells a team when its registration has been verified", () => {
    const items = build([], [unit({ status: "verified", verifiedAt: at(90) }), unit({ id: "u2" })]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "unit", event: "verified", unitName: "Yala boat team" });
    const { container } = renderWithIntl(
      <ul>
        <NoticeList items={items} read={[]} locale="en" emptyHint="" />
      </ul>,
      "en",
    );
    expect(container.textContent).toContain("Yala boat team has been verified");
    expect(container.querySelector('a[href="/en/requests"]')).not.toBeNull();
  });
});

describe("the journey's words", () => {
  const keys = (o: unknown, path = ""): string[] =>
    o && typeof o === "object"
      ? Object.entries(o).flatMap(([k, v]) => keys(v, path ? `${path}.${k}` : k))
      : [path];

  it("exist in all three languages, key for key", () => {
    expect(keys(ms.journey)).toEqual(keys(th.journey));
    expect(keys(en.journey)).toEqual(keys(th.journey));
    for (const group of ["sos", "supply", "unit"] as const) {
      expect(keys(ms.notices[group])).toEqual(keys(th.notices[group]));
      expect(keys(en.notices[group])).toEqual(keys(th.notices[group]));
    }
  });

  it("have a line for every piece of news the bell can carry", () => {
    for (const event of SOS_NEWS) {
      expect(typeof th.notices.sos[event]).toBe("string");
      expect(typeof th.notices.supply[event]).toBe("string");
    }
  });
});
