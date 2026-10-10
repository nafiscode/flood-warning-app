import { describe, expect, it } from "vitest";
import {
  caseState,
  coordsText,
  directionsHref,
  ETA_BANDS,
  secondsLeft,
  shouldAlarm,
  sortCases,
  splitMinutes,
  vulnerableKeys,
  type BoardCase,
} from "@/lib/dispatch";

const NOW = Date.parse("2026-11-20T09:30:00Z");
const inSeconds = (s: number) => new Date(NOW + s * 1000).toISOString();

const base: BoardCase = {
  sosId: "1",
  createdAt: new Date(NOW - 5 * 60_000).toISOString(),
  status: "received",
  hazard: "flood",
  lat: 6.5,
  lon: 101.2,
  accuracyM: 20,
  locationText: null,
  tambon: "950101",
  tambonNameTh: "สะเตง",
  tambonNameEn: "Sateng",
  peopleCount: 3,
  vulnerableFlags: {},
  depthRef: "waist",
  injuries: null,
  note: null,
  photos: [],
  voiceUrl: null,
  priorityScore: 5,
  hasPhone: true,
  suspectedSpam: false,
  waitingMinutes: 5,
  claimedBy: null,
  claimedByName: null,
  claimedIsMine: false,
  etaBand: null,
  etaGivenAt: null,
  offeredTo: null,
  offeredIsMine: false,
  offerExpiresAt: null,
  offerExhausted: false,
  myResponse: null,
};

const make = (over: Partial<BoardCase>): BoardCase => ({ ...base, ...over });

describe("what a card is", () => {
  it("knows when my own phone is the one being asked", () => {
    const c = make({ offeredIsMine: true, offerExpiresAt: inSeconds(40) });
    expect(caseState(c)).toBe("offered_to_me");
  });

  it("knows the case my unit holds from the one another unit holds", () => {
    expect(caseState(make({ claimedBy: "u1", claimedIsMine: true }))).toBe("mine");
    expect(caseState(make({ claimedBy: "u2", claimedIsMine: false }))).toBe("held_by_other");
  });

  it("says plainly when the relay has run out of teams", () => {
    expect(caseState(make({ offerExhausted: true }))).toBe("unanswered");
  });

  it("calls a case closed once it is finished, whatever the relay says", () => {
    expect(caseState(make({ status: "rescued", offeredIsMine: true }))).toBe("closed");
    expect(caseState(make({ status: "safe_cancelled" }))).toBe("closed");
  });
});

describe("the countdown", () => {
  it("counts down, and stops at zero rather than going negative", () => {
    expect(secondsLeft(make({ offerExpiresAt: inSeconds(42) }), NOW)).toBe(42);
    expect(secondsLeft(make({ offerExpiresAt: inSeconds(-9) }), NOW)).toBe(0);
  });

  it("is nothing at all when no offer is open", () => {
    expect(secondsLeft(base, NOW)).toBeNull();
  });
});

describe("the order of the board", () => {
  it("puts the case ringing my phone first, and the unanswered ones next", () => {
    const sorted = sortCases([
      make({ sosId: "held", claimedBy: "u2" }),
      make({ sosId: "mine", claimedBy: "u1", claimedIsMine: true }),
      make({ sosId: "none", offerExhausted: true }),
      make({ sosId: "ringing", offeredIsMine: true, offerExpiresAt: inSeconds(30) }),
      make({ sosId: "searching", offeredTo: "u3" }),
    ]);
    expect(sorted.map((c) => c.sosId)).toEqual(["ringing", "none", "searching", "mine", "held"]);
  });

  it("puts the worse case first, then the longer wait", () => {
    const sorted = sortCases([
      make({ sosId: "low", priorityScore: 1, waitingMinutes: 50 }),
      make({ sosId: "high", priorityScore: 9, waitingMinutes: 2 }),
      make({ sosId: "same-older", priorityScore: 9, waitingMinutes: 40 }),
    ]);
    expect(sorted.map((c) => c.sosId)).toEqual(["same-older", "high", "low"]);
  });

  it("leaves the caller's array alone", () => {
    const input = [make({ sosId: "a" }), make({ sosId: "b", offeredIsMine: true })];
    sortCases(input);
    expect(input.map((c) => c.sosId)).toEqual(["a", "b"]);
  });
});

describe("the alarm", () => {
  it("sounds only while a case is being offered to this unit", () => {
    expect(shouldAlarm([make({ offeredIsMine: true, offerExpiresAt: inSeconds(10) })], NOW)).toBe(
      true,
    );
    expect(shouldAlarm([make({ offeredIsMine: true, offerExpiresAt: inSeconds(-1) })], NOW)).toBe(
      false,
    );
    // Somebody else's turn, or nobody's: quiet.
    expect(shouldAlarm([make({ offeredTo: "u9", offerExpiresAt: inSeconds(30) })], NOW)).toBe(
      false,
    );
    expect(shouldAlarm([make({ offerExhausted: true })], NOW)).toBe(false);
    expect(shouldAlarm([], NOW)).toBe(false);
  });
});

describe("getting there", () => {
  it("builds a plain maps link, with no key and nothing of ours in it", () => {
    const href = directionsHref(6.54321, 101.28);
    expect(href).toContain("https://www.google.com/maps/dir/?api=1");
    expect(href).toContain("destination=6.543210%2C101.280000");
    expect(href).toContain("travelmode=driving");
    expect(href).not.toMatch(/key=|jaga/i);
  });

  it("reads coordinates out to five places, which is a few metres", () => {
    expect(coordsText(6.5, 101.2)).toBe("6.50000, 101.20000");
  });
});

describe("small things the card needs", () => {
  it("lists the vulnerable categories in a fixed order, and only the ticked ones", () => {
    expect(vulnerableKeys({ needs_oxygen: true, elderly: true, pregnant: false })).toEqual([
      "elderly",
      "needs_oxygen",
    ]);
    expect(vulnerableKeys({})).toEqual([]);
  });

  it("splits a wait into hours and minutes", () => {
    expect(splitMinutes(72)).toEqual({ hours: 1, minutes: 12 });
    expect(splitMinutes(0)).toEqual({ hours: 0, minutes: 0 });
    expect(splitMinutes(-5)).toEqual({ hours: 0, minutes: 0 });
  });

  it("offers the estimate bands in order, ending with 'cannot say yet'", () => {
    expect(ETA_BANDS).toEqual(["under15", "to30", "to60", "over60", "unknown"]);
  });
});
