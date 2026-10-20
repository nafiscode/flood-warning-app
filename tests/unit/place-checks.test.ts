import { describe, expect, it } from "vitest";
import {
  CHECK_WINDOW_MS,
  checkWindowMs,
  freshness,
  overdueHours,
  type RoundPlace,
} from "@/lib/place-checks";

/**
 * When a check has gone stale. The rule being guarded: a stale check is a marker and never a
 * downgrade - the place keeps the status somebody last gave it, and the card says plainly how
 * old that is (safety rule 3, which treats an alert the same way).
 */

const AT = "2026-11-20T06:00:00.000Z"; // 13:00 Bangkok
const after = (hours: number) => new Date(Date.parse(AT) + hours * 60 * 60 * 1000);

describe("freshness", () => {
  it("says nobody has been when there is no check", () => {
    expect(freshness({ checkedAt: null, source: null })).toEqual({ state: "never" });
    expect(freshness({ checkedAt: AT, source: null })).toEqual({ state: "never" });
    expect(freshness({ checkedAt: null, source: "team" })).toEqual({ state: "never" });
  });

  it("treats a time it cannot read as never, not as fresh", () => {
    expect(freshness({ checkedAt: "soon", source: "team" })).toEqual({ state: "never" });
  });

  it("is fresh inside the window and stale past it", () => {
    const due = new Date(Date.parse(AT) + 6 * 60 * 60 * 1000).toISOString();
    expect(freshness({ checkedAt: AT, source: "team", dueAt: due, now: after(5) }).state).toBe(
      "fresh",
    );
    expect(freshness({ checkedAt: AT, source: "team", dueAt: due, now: after(7) }).state).toBe(
      "stale",
    );
  });

  it("keeps who said it, whichever state it is in", () => {
    const due = new Date(Date.parse(AT) + 60 * 60 * 1000).toISOString();
    for (const source of ["admin", "team", "resident"] as const) {
      expect(freshness({ checkedAt: AT, source, dueAt: due, now: after(9) })).toEqual({
        state: "stale",
        at: AT,
        source,
      });
    }
  });

  it("falls back to the level's own window when no due time came with the card", () => {
    // A card saved for offline use before this release carries no due time (safety rule 7: what
    // is cached has to stay readable, and must not read as fresher than it is).
    expect(freshness({ checkedAt: AT, source: "team", level: "warning", now: after(7) }).state).toBe(
      "stale",
    );
    expect(freshness({ checkedAt: AT, source: "team", level: "normal", now: after(7) }).state).toBe(
      "fresh",
    );
  });

  it("tightens the window as the level rises", () => {
    const hours = (level: string) => checkWindowMs(level) / (60 * 60 * 1000);
    expect(hours("evacuate")).toBe(2);
    expect(hours("warning")).toBe(6);
    expect(hours("watch")).toBe(24);
    expect(hours("normal")).toBe(24 * 7);
    // An unknown or missing level is never treated as the shortest window by accident.
    expect(hours("something else")).toBe(hours("normal"));
    expect(checkWindowMs(null)).toBe(CHECK_WINDOW_MS.normal);
  });

  it("matches place_check_window in the database", () => {
    // The table in supabase/migrations/20261020120000_a10_place_checks.sql. If one changes, this
    // fails, which is the point: a card and a round list must not disagree about what is overdue.
    expect(CHECK_WINDOW_MS).toMatchObject({
      evacuate: 2 * 3600_000,
      warning: 6 * 3600_000,
      watch: 24 * 3600_000,
      normal: 168 * 3600_000,
      return: 168 * 3600_000,
    });
  });
});

const roundPlace = (over: Partial<RoundPlace> = {}): RoundPlace => ({
  id: "p1",
  name: { th: "ศูนย์พักพิง" },
  type: "shelter",
  tambon: "940111",
  tambonTh: "ตะลุโบะ",
  tambonEn: "Talubo",
  lat: 6.86,
  lon: 101.25,
  status: "open",
  verified: true,
  capacity: 120,
  needs: null,
  checkedAt: AT,
  checkedSource: "team",
  dueAt: new Date(Date.parse(AT) + 6 * 60 * 60 * 1000).toISOString(),
  level: "warning",
  mine: false,
  ...over,
});

describe("overdueHours", () => {
  it("is null when nobody has ever been, which is not the same as overdue by nothing", () => {
    expect(overdueHours(roundPlace({ checkedAt: null }))).toBeNull();
  });

  it("is zero while the check still holds", () => {
    expect(overdueHours(roundPlace(), after(5))).toBe(0);
  });

  it("counts whole hours past the window", () => {
    expect(overdueHours(roundPlace(), after(9))).toBe(3);
    expect(overdueHours(roundPlace(), after(6.5))).toBe(0);
  });
});
