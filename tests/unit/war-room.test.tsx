import { describe, expect, it, vi } from "vitest";
import { WarRoom } from "@/components/admin/WarRoom";
import { EXAMPLE_BOARD, EXAMPLE_MAP_DATA, EXAMPLE_PEOPLE } from "@/lib/war-room-examples";
import {
  ageMinutes,
  caseState,
  casesPerHour,
  directionsHref,
  hasNoUnit,
  isOpen,
  peak,
  sortCases,
  splitMinutes,
  topAreas,
  triage,
  vulnerableKeys,
  waitingMinutes,
  type SosCase,
} from "@/lib/war-room";
import th from "@/messages/th.json";
import { renderWithIntl } from "./render";

// The real map needs WebGL. Here it only says which layers it was asked to draw.
vi.mock("@/components/admin/WarRoomMap", () => ({
  WarRoomMap: ({ shown }: { shown: string[] }) => <div data-map-layers={shown.join(",")} />,
  MapLegend: ({ shown }: { shown: string[] }) => <ul data-legend={shown.join(",")} />,
}));

const NOW = Date.parse("2026-11-20T09:30:00Z");
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

const base: SosCase = {
  id: "11111111-1111-4111-8111-111111111111",
  createdAt: ago(5),
  closedAt: null,
  status: "received",
  hazard: "flood",
  lat: 6.8,
  lon: 101.2,
  accuracyM: 20,
  locationText: null,
  tambon: "940104",
  tambonTh: "บานา",
  tambonEn: "Bana",
  districtTh: "เมืองปัตตานี",
  provinceTh: "ปัตตานี",
  provinceCode: "94",
  peopleCount: 2,
  vulnerable: {},
  depth: "knee",
  injuries: null,
  note: null,
  photos: 0,
  hasVoice: false,
  batteryPct: null,
  onBehalf: false,
  onBehalfNote: null,
  hasPhone: true,
  requesterName: null,
  priority: 1,
  suspectedSpam: false,
  spamDismissedAt: null,
  duplicateOf: null,
  possibleDuplicateOf: null,
  mergedIn: 0,
  unitId: null,
  unitName: null,
  orgName: null,
  claimedAt: null,
  lastEvent: "received",
  lastEventAt: null,
  unitsCovering: 2,
};

const a = (id: string, more: Partial<SosCase>): SosCase => ({ ...base, ...more, id });

describe("how long a case has waited", () => {
  it("counts from when it was sent until a unit takes it", () => {
    const c = a("1", { createdAt: ago(40), claimedAt: ago(25) });
    expect(waitingMinutes(c, NOW)).toBe(15);
    // The age keeps running after the claim; the waiting time does not.
    expect(ageMinutes(c, NOW)).toBe(40);
  });

  it("stops at closure for a case nobody ever took", () => {
    const c = a("1", { createdAt: ago(60), closedAt: ago(30), status: "safe_cancelled" });
    expect(waitingMinutes(c, NOW)).toBe(30);
  });

  it("never goes negative when a clock is out by a few seconds", () => {
    expect(waitingMinutes(a("1", { createdAt: new Date(NOW + 30_000).toISOString() }), NOW)).toBe(
      0,
    );
  });
});

describe("the state of a case", () => {
  const states = (c: SosCase, minutes = 15) => caseState(c, NOW, minutes);

  it("is overdue only once it passes the setting, and the setting decides", () => {
    const c = a("1", { createdAt: ago(20) });
    expect(states(c)).toBe("overdue");
    expect(states(c, 60)).toBe("waiting");
  });

  it("is working the moment a unit holds it, however long it waited", () => {
    expect(states(a("1", { createdAt: ago(90), unitId: "u", claimedAt: ago(80) }))).toBe("working");
  });

  it("is closed for rescued, cancelled and dismissed", () => {
    for (const status of ["rescued", "safe_cancelled", "dismissed"] as const) {
      expect(states(a("1", { status, closedAt: ago(1) }))).toBe("closed");
      expect(isOpen(a("1", { status }))).toBe(false);
    }
  });

  it("calls out a case no verified unit covers, but only while it is open and unanswered", () => {
    expect(hasNoUnit(a("1", { unitsCovering: 0 }))).toBe(true);
    expect(hasNoUnit(a("1", { unitsCovering: 0, unitId: "u" }))).toBe(false);
    expect(hasNoUnit(a("1", { unitsCovering: 0, status: "rescued" }))).toBe(false);
    expect(hasNoUnit(a("1", { unitsCovering: 1 }))).toBe(false);
  });
});

describe("the order of the board", () => {
  it("puts the longest unanswered case first, then the rest, then what is done", () => {
    const cases = [
      a("closed", { status: "rescued", closedAt: ago(1), createdAt: ago(300) }),
      a("fresh", { createdAt: ago(2) }),
      a("working", { createdAt: ago(200), unitId: "u", claimedAt: ago(150) }),
      a("old", { createdAt: ago(90) }),
      a("older", { createdAt: ago(120) }),
    ];
    expect(sortCases(cases, NOW, 15).map((c) => c.id)).toEqual([
      "older",
      "old",
      "fresh",
      "working",
      "closed",
    ]);
  });

  it("breaks a tie on priority, so more people and more need come first", () => {
    const cases = [
      a("low", { createdAt: ago(30), priority: 2 }),
      a("high", { createdAt: ago(30), priority: 9 }),
    ];
    expect(sortCases(cases, NOW, 15).map((c) => c.id)).toEqual(["high", "low"]);
  });

  it("splits into the four bands", () => {
    const bands = triage(
      [
        a("overdue", { createdAt: ago(30) }),
        a("waiting", { createdAt: ago(3) }),
        a("working", { unitId: "u", claimedAt: ago(1) }),
        a("closed", { status: "rescued", closedAt: ago(1) }),
      ],
      NOW,
      15,
    );
    expect(bands.overdue.map((c) => c.id)).toEqual(["overdue"]);
    expect(bands.waiting.map((c) => c.id)).toEqual(["waiting"]);
    expect(bands.working.map((c) => c.id)).toEqual(["working"]);
    expect(bands.closed.map((c) => c.id)).toEqual(["closed"]);
  });
});

describe("the small pieces", () => {
  it("lists the vulnerability flags that are set, worst first and only the true ones", () => {
    expect(vulnerableKeys({ elderly: true, bedridden: true, pregnant: false })).toEqual([
      "bedridden",
      "elderly",
    ]);
    expect(vulnerableKeys({})).toEqual([]);
    expect(vulnerableKeys(null)).toEqual([]);
    // A flag the app does not know yet is still shown, after the ones it does.
    expect(vulnerableKeys({ elderly: true, something_new: true })).toEqual([
      "elderly",
      "something_new",
    ]);
  });

  it("counts the cases of each of the last 24 hours", () => {
    const buckets = casesPerHour(
      [
        a("1", { createdAt: ago(10) }),
        a("2", { createdAt: ago(20) }),
        a("3", { createdAt: ago(60 * 40) }),
      ],
      NOW,
    );
    expect(buckets).toHaveLength(24);
    // The two recent ones are in the last bucket; the one from 40 hours ago is in none of them.
    expect(buckets.at(-1)!.count).toBe(2);
    expect(buckets.reduce((n, b) => n + b.count, 0)).toBe(2);
    expect(peak(buckets)).toBe(2);
    expect(peak([{ count: 0 }])).toBe(1);
  });

  it("splits minutes into hours and minutes", () => {
    expect(splitMinutes(135)).toEqual({ hours: 2, minutes: 15 });
    expect(splitMinutes(45)).toEqual({ hours: 0, minutes: 45 });
    expect(splitMinutes(-5)).toEqual({ hours: 0, minutes: 0 });
  });

  it("ranks the areas by the people in them", () => {
    const ranked = topAreas(EXAMPLE_MAP_DATA.watched, 3);
    expect(ranked).toHaveLength(3);
    expect(ranked[0]!.homes + ranked[0]!.places).toBeGreaterThanOrEqual(
      ranked[1]!.homes + ranked[1]!.places,
    );
  });

  it("builds a directions link to the case", () => {
    expect(directionsHref(6.8, 101.2)).toContain("destination=6.8,101.2");
  });
});

describe("the war room on screen", () => {
  const show = (view: "cases" | "people" | "map" = "cases") =>
    renderWithIntl(
      <WarRoom
        initial={EXAMPLE_BOARD}
        view={view}
        people={EXAMPLE_PEOPLE}
        mapData={EXAMPLE_MAP_DATA}
        panels={{ reveal: null, assign: null, history: null, form: null }}
        personReveal={null}
        path={null}
        pollUrl={null}
        actions={null}
        done={null}
        error={null}
      />,
    );

  it("shouts about the cases nobody has answered, in words and not only in colour", () => {
    const { getByText, container } = show();
    expect(getByText(th.warRoom.gate.badge)).toBeTruthy();
    // Three of the made-up cases have waited longer than the 15-minute setting.
    expect(container.textContent).toContain("3");
    expect(container.querySelectorAll("article").length).toBeGreaterThan(3);
  });

  it("says in words how long each case has waited", () => {
    const { container } = show();
    expect(container.textContent).toContain("47");
    expect(container.textContent).toContain("23");
  });

  it("warns when no verified unit covers the tambon of a waiting case", () => {
    const { getAllByText } = show();
    expect(getAllByText(th.warRoom.case.noUnit).length).toBeGreaterThan(0);
  });

  it("keeps a case flagged as spam on the board, with its flag shown", () => {
    const { getAllByText } = show();
    expect(getAllByText(th.warRoom.case.spamFlag).length).toBe(1);
  });

  it("never puts a phone number on the board, only whether there is one", () => {
    const { container } = show();
    expect(container.textContent).toContain(th.warRoom.case.hasPhone);
    expect(container.querySelector('a[href^="tel:"]')).toBe(null);
  });

  it("shows the people list without any phone number", () => {
    const { container } = show("people");
    expect(container.textContent).toContain("นูรฮายาตี");
    expect(container.querySelector('a[href^="tel:"]')).toBe(null);
  });

  it("draws the map with the layers that are switched on", () => {
    const { container } = show("map");
    expect(container.querySelector("[data-map-layers]")?.getAttribute("data-map-layers")).toBe(
      "cases,density",
    );
  });

  it("leaves every button idle when it has no actions (the example page)", () => {
    const { container } = show();
    expect(container.querySelectorAll('[aria-disabled="true"]').length).toBeGreaterThan(5);
  });
});

describe("the links out of the war room", () => {
  /*
   * The page passes the route without a language prefix, because next-intl's <Link> adds it.
   * Giving it an already-prefixed path produced /en/en/... and "page not found" in every
   * language but Thai, where the default locale has no prefix (seen by the owner, 9 Oct).
   */
  const withPath = (locale: "th" | "en") =>
    renderWithIntl(
      <WarRoom
        initial={EXAMPLE_BOARD}
        view="cases"
        people={EXAMPLE_PEOPLE}
        mapData={EXAMPLE_MAP_DATA}
        panels={{ reveal: null, assign: null, history: null, form: null }}
        personReveal={null}
        path="/admin/war-room"
        pollUrl={null}
        actions={null}
        done={null}
        error={null}
      />,
      locale,
    );

  const ownLinks = (container: HTMLElement) =>
    [...container.querySelectorAll("a")]
      .map((a) => a.getAttribute("href") ?? "")
      .filter((href) => href.includes("/admin/war-room"));

  it("carry the language exactly once, in English", () => {
    const { container } = withPath("en");
    const links = ownLinks(container);
    expect(links.length).toBeGreaterThan(3);
    for (const href of links) {
      expect(href, href).toMatch(/^\/en\/admin\/war-room(\?|$)/);
      expect(href, href).not.toContain("/en/en/");
    }
  });

  it("carry no prefix at all in Thai, the language without one", () => {
    const { container } = withPath("th");
    const links = ownLinks(container);
    expect(links.length).toBeGreaterThan(3);
    for (const href of links) expect(href, href).toMatch(/^\/admin\/war-room(\?|$)/);
  });
});
