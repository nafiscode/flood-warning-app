// @vitest-environment jsdom
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  bare,
  GUIDE_TOURS,
  NO_TOUR,
  placeCard,
  toursFor,
  type CardPlace,
  type Rect,
} from "@/lib/guide-tour";

const messages = (locale: string) =>
  JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")).guide as Record<string, unknown>;

// All the code that draws the pages, as one string, to look for the attributes the steps name.
const source = execSync("git ls-files app components", { encoding: "utf8" })
  .split("\n")
  .filter((f) => f.endsWith(".tsx"))
  .map((f) => readFileSync(f, "utf8"))
  .join("\n");

describe("the guide tour", () => {
  it("has words for every step in every language", () => {
    for (const locale of ["th", "ms", "en"]) {
      const guide = messages(locale);
      for (const word of ["show", "label", "progress", "close", "back", "next", "done"]) {
        expect(typeof guide[word], `${locale} ${word}`).toBe("string");
      }
      for (const tour of GUIDE_TOURS) {
        for (const step of tour.steps) {
          const entry = (guide[tour.id] as Record<string, { title: string; body: string }>)?.[
            step.id
          ];
          expect(entry?.title, `${locale} ${tour.id}.${step.id}.title`).toBeTruthy();
          expect(entry?.body, `${locale} ${tour.id}.${step.id}.body`).toBeTruthy();
        }
      }
    }
  });

  it("points only at attributes that a component still draws", () => {
    for (const tour of GUIDE_TOURS) {
      for (const step of tour.steps) {
        for (const [name] of step.target.matchAll(/data-[a-z-]+/g)) {
          expect(source, `${tour.id}.${step.id} -> ${name}`).toContain(name);
        }
      }
    }
  });

  it("has no admin tour and none for the SOS screens", () => {
    for (const tour of GUIDE_TOURS) expect(tour.path.test("/admin")).toBe(false);
    expect(toursFor("/th/sos")).toEqual([]);
    expect(NO_TOUR.test("/sos")).toBe(true);
    expect(NO_TOUR.test("/sos/abc")).toBe(true);
    expect(NO_TOUR.test("/supplies")).toBe(false);
  });

  it("keeps the screens for asking help to the button only", () => {
    for (const id of ["supplies", "report", "fieldRescue"]) {
      expect(GUIDE_TOURS.find((t) => t.id === id)?.manualOnly).toBe(true);
    }
  });

  it("finds a page's tours without its language", () => {
    expect(bare("/th")).toBe("/");
    expect(bare("/ms/map/")).toBe("/map");
    expect(toursFor("/en/authority").map((t) => t.id)).toEqual(["notVerified", "console"]);
    expect(toursFor("/th/authority/mine").map((t) => t.id)).toEqual(["mine"]);
  });
});

describe("what the guide remembers", () => {
  it("remembers steps one by one, so a button that appears later is still new", async () => {
    const { markSeen, readSeen, stepKey } = await import("@/lib/guide-tour");
    window.localStorage.clear();
    markSeen([stepKey("account", "setup"), stepKey("account", "requests")]);
    const seen = readSeen();
    expect(seen[stepKey("account", "setup")]).toBe(true);
    expect(seen[stepKey("account", "myCases")]).toBeUndefined();
  });
});

/**
 * Where the card sits (the owner, 27 Oct 2026: "review and improve" the tablet view). It used to
 * be centred at the top or the bottom of the window, whichever half the target was not in, which
 * put it on top of the map - and in portrait on top of the map's toolbar, the buttons the tour
 * goes on to describe. These are the iPad geometries it was measured on.
 */
describe("where the guide's card sits", () => {
  const CARD = { width: 384, height: 264 };
  const hits = (a: Rect, b: Rect) =>
    a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  const boxOf = (place: CardPlace, viewport: { width: number; height: number }): Rect => {
    if (place.how === "beside")
      return {
        left: place.left,
        top: place.top,
        right: place.left + place.width,
        bottom: place.top + CARD.height,
      };
    const left = (viewport.width - CARD.width) / 2;
    const top = place.how === "top" ? place.top : viewport.height - place.bottom - CARD.height;
    return { left, top, right: left + CARD.width, bottom: top + CARD.height };
  };

  // 1,180 x 820: the map is 727 px wide with the answer panel to its right.
  const LAND = { viewport: { width: 1180, height: 820 }, head: 107, foot: 750 };
  const MAP_LAND: Rect = { left: 30, top: 298, right: 757, bottom: 654 };
  // 820 x 1,180: the map is 608 px wide in the middle of the page, with nothing either side.
  const PORT = { viewport: { width: 820, height: 1180 }, head: 155, foot: 1110 };
  const MAP_PORT: Rect = { left: 106, top: 229, right: 714, bottom: 1079 };

  it("keeps the far side of the window for a small target, as it always did", () => {
    const readout: Rect = { left: 40, top: 200, right: 260, bottom: 300 };
    const place = placeCard({ ring: readout, ...LAND, card: CARD });
    expect(place).toEqual({ how: "bottom", bottom: 820 - 750 + 8 });
    const lower: Rect = { left: 40, top: 560, right: 260, bottom: 640 };
    expect(placeCard({ ring: lower, ...LAND, card: CARD })).toEqual({ how: "top", top: 115 });
  });

  it("goes beside the map on a landscape iPad, and covers none of it", () => {
    const place = placeCard({ ring: MAP_LAND, ...LAND, card: CARD });
    expect(place.how).toBe("beside");
    if (place.how !== "beside") return;
    expect(place.left).toBeGreaterThanOrEqual(MAP_LAND.right);
    expect(place.left + place.width).toBeLessThanOrEqual(LAND.viewport.width - 8);
    expect(hits(boxOf(place, LAND.viewport), MAP_LAND)).toBe(false);
    // Level with the top of what it points at, and never under the header or over the hotlines.
    expect(place.top).toBe(MAP_LAND.top);
    expect(place.top + CARD.height).toBeLessThanOrEqual(LAND.foot - 8);
  });

  it("uses the bottom edge in portrait, where nothing fits beside the map, so the toolbar stays clear", () => {
    const place = placeCard({ ring: MAP_PORT, ...PORT, card: CARD });
    expect(place).toEqual({ how: "bottom", bottom: 1180 - 1110 + 8 });
    // The map's tools are along its top edge: the card must leave them alone.
    const toolbar: Rect = { left: 106, top: 232, right: 714, bottom: 290 };
    expect(hits(boxOf(place, PORT.viewport), toolbar)).toBe(false);
  });

  it("chooses the roomier side, and refuses a side that cannot hold the whole card", () => {
    const left: Rect = { left: 700, top: 300, right: 1150, bottom: 650 };
    const place = placeCard({ ring: left, ...LAND, card: CARD });
    expect(place.how).toBe("beside");
    if (place.how === "beside") expect(place.left + place.width).toBeLessThanOrEqual(left.left);
    const narrow: Rect = { left: 300, top: 300, right: 880, bottom: 650 };
    expect(placeCard({ ring: narrow, ...LAND, card: CARD }).how).not.toBe("beside");
  });

  it("keeps the card near a target in the header or the hotline bar", () => {
    // The bell is in the frozen header, the hotlines in the bar: the card sits just under the one
    // and just above the other, not across the window from what it names.
    const bell: Rect = { left: 1097, top: 0, right: 1157, bottom: 60 };
    expect(placeCard({ ring: bell, ...LAND, card: CARD })).toEqual({ how: "top", top: 115 });
    const hotlines: Rect = { left: 0, top: 750, right: 1180, bottom: 820 };
    expect(placeCard({ ring: hotlines, ...LAND, card: CARD })).toEqual({
      how: "bottom",
      bottom: 820 - 750 + 8,
    });
  });

  it("falls back to the top when the target is not on the screen", () => {
    expect(placeCard({ ring: null, ...LAND, card: CARD })).toEqual({ how: "top", top: 115 });
  });
});
