/**
 * A14: requests for food, water and essentials (spec 4.10), on the phone and on the boards.
 *
 * What these tests hold on to: the way to a real SOS is on the supplies form itself; the request
 * carries its kind and its needs; a supply request never rings the alarm, never wears the SOS
 * red and never outranks a rescue case nobody holds; and its sender has one button that turns it
 * into a rescue. The database half is in tests/rls/supplies.test.ts.
 */
import { fireEvent, waitFor } from "@testing-library/dom";
import { act, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BoardView } from "@/components/authority/BoardView";
import type { CaseActions } from "@/components/authority/CaseCard";
import { CaseStatus } from "@/components/sos/CaseStatus";
import { SendSupplies } from "@/components/sos/SendSupplies";
import { EXAMPLE_AUTHORITY_BOARD, EXAMPLE_NOW } from "@/lib/authority-examples";
import {
  caseState,
  filterCases,
  shouldAlarm,
  sortCases,
  supplyOffers,
  type BoardCase,
} from "@/lib/dispatch";
import { cleanNeeds, NEEDS, rememberCase, type SosTimeline } from "@/lib/sos";
import { SOUNDS, durationMs } from "@/lib/sounds";
import { caseState as warState, overdueAfter, sortCases as warSort } from "@/lib/war-room";
import { EXAMPLE_BOARD } from "@/lib/war-room-examples";
import en from "@/messages/en.json";
import ms from "@/messages/ms.json";
import th from "@/messages/th.json";
import { renderWithIntl } from "./render";

const replace = vi.fn();
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  useRouter: () => ({ replace, push: vi.fn() }),
}));

const SUPPLY = "88888888-0000-4000-8000-000000000008";
const OFFERED_RESCUE = "11111111-0000-4000-8000-000000000001";
const UNANSWERED_RESCUE = "22222222-0000-4000-8000-000000000002";
const byId = (id: string) => EXAMPLE_AUTHORITY_BOARD.cases.find((c) => c.sosId === id)!;

beforeEach(() => {
  window.localStorage.clear();
  replace.mockClear();
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: {
      getCurrentPosition: (ok: (p: unknown) => void) =>
        ok({ coords: { latitude: 6.8669, longitude: 101.2501, accuracy: 12 } }),
      watchPosition: () => 1,
      clearWatch: () => {},
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the words", () => {
  it("exist for every need in all three languages", () => {
    for (const messages of [th, en, ms]) {
      for (const need of NEEDS) expect(messages.sos.needs[need]).toBeTruthy();
      expect(Object.keys(messages.sos.supplies).sort()).toEqual(
        Object.keys(th.sos.supplies).sort(),
      );
      expect(Object.keys(messages.authority.supplies).sort()).toEqual(
        Object.keys(th.authority.supplies).sort(),
      );
      expect(messages.authorityRegister.capability.supplies.name).toBeTruthy();
    }
  });

  it("keeps only the needs on the list, in the list's order", () => {
    expect(cleanNeeds(["food", "gold", "water", "food"])).toEqual(["water", "food"]);
    expect(cleanNeeds("water")).toEqual([]);
  });
});

describe("the request form", () => {
  it("puts the way to a real SOS above everything it asks", async () => {
    await act(async () => {
      renderWithIntl(<SendSupplies />);
    });
    const toSos = document.querySelector("[data-supplies-not-rescue] a")!;
    expect(toSos.getAttribute("href")).toBe("/sos");
    const send = document.querySelector("[data-supplies-send]")!;
    expect(toSos.compareDocumentPosition(send) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Jaga carries the request; it holds no goods and collects none.
    expect(document.body.textContent).toContain(th.sos.supplies.scope);
  });

  it("sends what was ticked as a supply request, with nothing required but the location", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "99999999-9999-4999-8999-999999999999",
          token: "t".repeat(48),
          merged: false,
          status: "received",
          createdAt: new Date().toISOString(),
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => {
      renderWithIntl(<SendSupplies />);
    });
    fireEvent.click(document.querySelector('[data-need="medicine"]')!);
    // Medicine is on the list, with the line that an urgent need is a medical call.
    expect(document.querySelector("[data-medicine-hint]")?.textContent).toContain("1669");
    fireEvent.click(document.querySelector('[data-left="none"]')!);
    fireEvent.change(document.querySelector("[data-supplies-people]")!, {
      target: { value: "5" },
    });
    await act(async () => {
      fireEvent.click(document.querySelector("[data-supplies-send]")!);
    });
    await waitFor(() => expect(replace).toHaveBeenCalled());
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/sos");
    const body = JSON.parse((options as RequestInit).body as string);
    expect(body.kind).toBe("supplies");
    expect(body.needs).toEqual(["water", "food", "medicine"]);
    expect(body.suppliesLeft).toBe("none");
    expect(body.peopleCount).toBe(5);
    expect(body.lat).toBeCloseTo(6.8669);
    expect(replace).toHaveBeenCalledWith("/sos/99999999-9999-4999-8999-999999999999");
  });
});

describe("the sender's page", () => {
  const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const timeline = (more: Partial<SosTimeline> = {}): SosTimeline => ({
    status: "received",
    createdAt: new Date().toISOString(),
    closedAt: null,
    hazardType: "unknown",
    lat: 6.8,
    lon: 101.2,
    hasPhone: false,
    unitName: null,
    orgName: null,
    photos: 0,
    hasVoice: false,
    events: [{ event: "received", at: new Date().toISOString(), note: null, unit: null }],
    team: null,
    kind: "supplies",
    needs: ["water", "food"],
    needsNote: null,
    suppliesLeft: "none",
    ...more,
  });

  it("speaks of a delivery, lists what was asked for, and offers the rescue button", async () => {
    rememberCase({ id, token: "k".repeat(48), status: "received", createdAt: "" });
    const posted: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: string, options?: RequestInit) => {
        if (options?.method === "POST") {
          posted.push(JSON.parse(options.body as string).action);
          return Promise.resolve(new Response(JSON.stringify({ ok: true, status: "received" })));
        }
        return Promise.resolve(
          new Response(JSON.stringify(timeline({ kind: posted.length ? "rescue" : "supplies" }))),
        );
      }),
    );
    await act(async () => {
      renderWithIntl(<CaseStatus id={id} merged={false} />);
    });
    await waitFor(() => expect(document.querySelector("[data-case-kind='supplies']")).toBeTruthy());
    expect(document.querySelector("h1")?.textContent).toBe(th.sos.supplies.statusTitle);
    expect(document.querySelector("[data-case-status]")?.textContent).toBe(
      th.sos.supplies.status.received,
    );
    expect(document.querySelector("[data-case-needs]")?.textContent).toContain(th.sos.needs.water);
    expect(document.querySelector("[data-case-safe]")?.textContent).toBe(th.sos.supplies.cancel);

    const button = document.querySelector("[data-need-rescue-button]")!;
    expect(button.textContent).toContain(th.sos.supplies.escalate.button);
    await act(async () => {
      fireEvent.click(button);
    });
    await waitFor(() => expect(posted).toContain("need_rescue"));
    await waitFor(() => expect(document.querySelector("[data-case-kind='rescue']")).toBeTruthy());
    // It is a rescue case now: the rescue's own words, and no button to escalate twice.
    expect(document.querySelector("[data-escalated]")).toBeTruthy();
    expect(document.querySelector("[data-need-rescue-button]")).toBeNull();
    expect(document.querySelector("h1")?.textContent).toBe(th.sos.status.title);
  });

  it("says so at once, with the SOS button, when the change cannot be sent", async () => {
    rememberCase({ id, token: "k".repeat(48), status: "received", createdAt: "" });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementation((_url: string, options?: RequestInit) =>
          options?.method === "POST"
            ? Promise.reject(new Error("offline"))
            : Promise.resolve(new Response(JSON.stringify(timeline()))),
        ),
    );
    await act(async () => {
      renderWithIntl(<CaseStatus id={id} merged={false} />);
    });
    await waitFor(() => expect(document.querySelector("[data-need-rescue-button]")).toBeTruthy());
    await act(async () => {
      fireEvent.click(document.querySelector("[data-need-rescue-button]")!);
    });
    await waitFor(() =>
      expect(document.querySelector("[data-need-rescue] [role='alert']")?.textContent).toBe(
        th.sos.supplies.escalate.failed,
      ),
    );
    expect(document.querySelector("[data-need-rescue] a")?.getAttribute("href")).toBe("/sos");
  });

  it("leaves a rescue case exactly as it was", async () => {
    rememberCase({ id, token: "k".repeat(48), status: "received", createdAt: "" });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify(timeline({ kind: "rescue", needs: [], suppliesLeft: null }))),
        ),
    );
    await act(async () => {
      renderWithIntl(<CaseStatus id={id} merged={false} />);
    });
    await waitFor(() => expect(document.querySelector("[data-case-kind='rescue']")).toBeTruthy());
    expect(document.querySelector("[data-need-rescue]")).toBeNull();
    expect(document.querySelector("[data-case-needs]")).toBeNull();
    expect(document.querySelector("[data-case-safe]")?.textContent).toBe(th.sos.status.safeNow);
  });
});

describe("a team's board", () => {
  const actions = (): CaseActions => ({
    accept: vi.fn(),
    decline: vi.fn(),
    eta: vi.fn(),
    advance: vi.fn(),
    release: vi.fn(),
    phone: vi.fn(),
    complete: vi.fn(),
    confirm: vi.fn(),
    media: vi.fn(),
    assign: vi.fn(),
    unassign: vi.fn(),
  });
  const draw = (cases: BoardCase[] = EXAMPLE_AUTHORITY_BOARD.cases) => {
    const taps = actions();
    renderWithIntl(
      <BoardView
        board={{ ...EXAMPLE_AUTHORITY_BOARD, cases }}
        now={EXAMPLE_NOW}
        alarm="on"
        onArm={() => {}}
        busy={null}
        notice={null}
        phones={{}}
        media={{}}
        stale={false}
        onRefresh={null}
        actions={taps}
        unitActions={{ duty: vi.fn(), sharing: vi.fn() }}
      />,
    );
    return taps;
  };

  it("never rings for a supply request, which has one soft sound of its own", () => {
    const supply = byId(SUPPLY);
    expect(caseState(supply)).toBe("offered_to_me");
    expect(shouldAlarm([supply], EXAMPLE_NOW)).toBe(false);
    expect(supplyOffers([supply, byId(OFFERED_RESCUE)], EXAMPLE_NOW)).toEqual([SUPPLY]);
    expect(shouldAlarm([supply, byId(OFFERED_RESCUE)], EXAMPLE_NOW)).toBe(true);
    // Played once, unlike the alarm; lower and slower, so the two are not confused by ear.
    expect(SOUNDS.supplyOffer.repeatEveryMs).toBeNull();
    expect(SOUNDS.offer.repeatEveryMs).not.toBeNull();
    expect(Math.max(...SOUNDS.supplyOffer.tones.map((t) => t.freq))).toBeLessThan(
      Math.min(...SOUNDS.offer.tones.map((t) => t.freq)),
    );
    expect(durationMs("supplyOffer")).toBeGreaterThan(durationMs("offer"));
  });

  it("reads every rescue case nobody holds before a supply request", () => {
    const order = sortCases(EXAMPLE_AUTHORITY_BOARD.cases).map((c) => c.sosId);
    expect(order.indexOf(OFFERED_RESCUE)).toBeLessThan(order.indexOf(SUPPLY));
    expect(order.indexOf(UNANSWERED_RESCUE)).toBeLessThan(order.indexOf(SUPPLY));
    const searching = EXAMPLE_AUTHORITY_BOARD.cases.find(
      (c) => c.kind === "rescue" && caseState(c) === "searching",
    );
    if (searching) expect(order.indexOf(searching.sosId)).toBeLessThan(order.indexOf(SUPPLY));
  });

  it("filters by kind", () => {
    const all = EXAMPLE_AUTHORITY_BOARD.cases;
    const only = (kind: "rescue" | "supplies") =>
      filterCases(all, { scope: "open", tambon: null, vulnerableOnly: false, kind });
    expect(only("supplies").map((c) => c.sosId)).toEqual([SUPPLY]);
    expect(only("rescue").some((c) => c.kind === "supplies")).toBe(false);
  });

  it("marks the card in words, shows the needs, and never dresses it in the SOS red", () => {
    const taps = draw();
    const card = document.querySelector(`[data-case="${SUPPLY}"]`)!;
    expect(card.getAttribute("data-case-kind")).toBe("supplies");
    expect(card.querySelector("[data-supplies-mark]")?.textContent).toBe(
      th.authority.supplies.mark,
    );
    expect(card.querySelector("[data-case-needs]")?.textContent).toContain(th.sos.needs.baby);
    expect(card.querySelector("[data-case-needs]")?.textContent).toContain(
      th.authority.supplies.left.none,
    );
    expect(card.outerHTML).not.toContain("bg-sos");
    expect(card.outerHTML).not.toContain("border-sos");
    // The rescue case offered beside it still does.
    expect(document.querySelector(`[data-case="${OFFERED_RESCUE}"]`)!.outerHTML).toContain(
      "bg-sos",
    );
    const accept = card.querySelector("[data-accept]")!;
    expect(accept.textContent).toBe(th.authority.supplies.accept);
    fireEvent.click(accept);
    expect(taps.accept).toHaveBeenCalledWith(SUPPLY);
    // The board says one case is ringing, not two.
    expect(document.querySelector("[data-board-ringing]")?.getAttribute("data-board-ringing")).toBe(
      "1",
    );
  });

  it("reports a delivery in a delivery's words", () => {
    draw([
      {
        ...byId(SUPPLY),
        status: "assigned",
        claimedBy: "me",
        claimedIsMine: true,
        etaBand: "to30",
      },
    ]);
    const card = document.querySelector(`[data-case="${SUPPLY}"]`)!;
    expect(card.querySelector("[data-complete]")?.textContent).toContain(
      th.authority.supplies.complete.open,
    );
    fireEvent.click(card.querySelector("[data-complete]")!);
    expect(card.querySelector("[data-finish-form] legend")?.textContent).toBe(
      th.authority.supplies.complete.title,
    );
  });
});

describe("the war room", () => {
  const rescue = EXAMPLE_BOARD.cases.find((c) => c.status === "received" && !c.unitId)!;
  const now = EXAMPLE_BOARD.now;
  const waiting = (minutes: number, kind: "rescue" | "supplies") => ({
    ...rescue,
    id: `${kind}-${minutes}`,
    kind,
    createdAt: new Date(now - minutes * 60_000).toISOString(),
  });

  it("gives a supply request an hour before calling it overdue", () => {
    expect(overdueAfter(waiting(0, "rescue"), 15)).toBe(15);
    expect(overdueAfter(waiting(0, "supplies"), 15)).toBe(60);
    expect(overdueAfter(waiting(0, "supplies"), 30)).toBe(120);
    expect(warState(waiting(20, "rescue"), now, 15)).toBe("overdue");
    expect(warState(waiting(20, "supplies"), now, 15)).toBe("waiting");
    expect(warState(waiting(61, "supplies"), now, 15)).toBe("overdue");
  });

  it("reads the rescue cases first within a state", () => {
    const order = warSort([waiting(90, "supplies"), waiting(20, "rescue")], now, 15);
    expect(order.map((c) => c.kind)).toEqual(["rescue", "supplies"]);
  });
});
