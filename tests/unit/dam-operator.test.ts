import { describe, expect, it } from "vitest";
import { canEnd, canWithdraw, type OperatorRelease } from "@/lib/dam-operator";
import {
  releaseEndReason,
  releaseEndText,
  releaseText,
  type ReleaseEndInput,
  type ReleaseInput,
} from "@/lib/dam-release";
import en from "@/messages/en.json";
import ms from "@/messages/ms.json";
import th from "@/messages/th.json";

/**
 * A12 part 2: the dam operator's words and what their screen offers them.
 *
 * The most important assertion in this file is the dullest-looking one: the "gates have closed"
 * message must not read like relief. The water that left while they were open is still coming,
 * so the message carries the "still on its way" paragraph and the issuer line that names the dam
 * instead of a Jaga admin. The level itself is kept by the database (tests/rls/dam-operator).
 */

const MESSAGES = { th, ms, en } as Record<string, typeof en>;

/** The reviewed template, read exactly as the server and the browser read it. */
function sayFor(locale: string) {
  const dam = MESSAGES[locale]!.dam as unknown as Record<string, Record<string, string>>;
  return (key: string, values: Record<string, string | number> = {}) => {
    const [group, name] = key.split(".") as [string, string];
    const raw = dam[group]?.[name] ?? "";
    return Object.entries(values).reduce(
      (text, [k, v]) => text.replaceAll(`{${k}}`, String(v)),
      raw,
    );
  };
}

const time = (at: Date) => at.toISOString();

const GATES_OPEN = new Date("2026-11-09T02:00:00Z");
const GATES_SHUT = new Date("2026-11-09T09:00:00Z");

const base = {
  damName: "Bang Lang Dam",
  river: "Pattani",
  operator: "EGAT",
  onset: { from: new Date("2026-11-09T05:00:00Z"), to: new Date("2026-11-10T00:00:00Z") },
};

const release = (over: Partial<ReleaseInput> = {}): ReleaseInput => ({
  ...base,
  gatesOpenAt: GATES_OPEN,
  releaseCms: 650,
  expectedEndAt: null,
  ...over,
});

const ended = (over: Partial<ReleaseEndInput> = {}): ReleaseEndInput => ({
  ...base,
  gatesClosedAt: GATES_SHUT,
  ...over,
});

describe("who the notice says issued it", () => {
  it("an admin's notice names a Jaga admin; the dam's own names the dam", () => {
    for (const locale of ["th", "ms", "en"]) {
      const say = sayFor(locale);
      const byAdmin = releaseText(say, time, release());
      const byDam = releaseText(say, time, release({ byOperator: true }));
      expect(byAdmin).not.toBe(byDam);
      expect(byAdmin.endsWith(say("release.issuer", { operator: "EGAT" }))).toBe(true);
      expect(byDam.endsWith(say("release.issuerOperator", { operator: "EGAT" }))).toBe(true);
    }
  });
});

describe("the gates have closed", () => {
  it("says the water is still coming, in all three languages", () => {
    for (const locale of ["th", "ms", "en"]) {
      const say = sayFor(locale);
      const text = releaseEndText(say, time, ended());
      // The paragraph that keeps a shut gate from reading as an all-clear.
      expect(text).toContain(say("end.still"));
      // It never borrows the release notice's "open gates" sentence.
      expect(text).not.toContain(say("release.body", { dam: "Bang Lang Dam" }));
      // The issuer is the dam, never an admin: only the dam can send this one.
      expect(text.endsWith(say("release.issuerOperator", { operator: "EGAT" }))).toBe(true);
      // Four paragraphs at least: what happened, still coming, the window, what to do.
      expect(text.split("\n\n").length).toBeGreaterThanOrEqual(5);
    }
  });

  it("names the time the gates shut, not the time they opened", () => {
    const text = releaseEndText(sayFor("en"), time, ended());
    expect(text).toContain(time(GATES_SHUT));
    expect(text).not.toContain(time(GATES_OPEN));
  });

  it("keeps the arrival window it was given, and leaves it out when there is none", () => {
    const say = sayFor("en");
    const withWindow = releaseEndText(say, time, ended());
    expect(withWindow).toContain(time(base.onset.from));
    const without = releaseEndText(say, time, ended({ onset: null }));
    expect(without).not.toContain(time(base.onset.from));
  });

  it("the reason line is one line and names the dam and the time", () => {
    const reason = releaseEndReason(sayFor("en"), time, ended());
    expect(reason).not.toContain("\n");
    expect(reason).toContain("Bang Lang Dam");
    expect(reason).toContain(time(GATES_SHUT));
    // Safety rule 3 puts the reason on every screen, and the column refuses under three characters.
    expect(reason.length).toBeGreaterThan(3);
  });
});

describe("what the operator's screen offers for a notice", () => {
  const row = (over: Partial<OperatorRelease> = {}): OperatorRelease => ({
    alertId: "11111111-1111-1111-1111-111111111111",
    damCode: "bang_lang",
    level: "warning",
    releaseCms: 650,
    gatesOpenAt: GATES_OPEN.toISOString(),
    gatesClosedAt: null,
    expectedEndAt: null,
    kind: "dam_release",
    isDrill: false,
    mine: true,
    tambons: 55,
    issuedAt: GATES_OPEN.toISOString(),
    nextUpdateAt: GATES_SHUT.toISOString(),
    cancelledAt: null,
    ...over,
  });

  it("offers both on a notice the dam sent itself", () => {
    expect(canEnd(row())).toBe(true);
    expect(canWithdraw(row())).toBe(true);
  });

  it("offers ending, but not withdrawing, on one a Jaga admin sent", () => {
    // The gates shutting is a fact only the dam knows and it lowers no level; taking Jaga's own
    // words off every phone is Jaga's to do.
    expect(canEnd(row({ mine: false }))).toBe(true);
    expect(canWithdraw(row({ mine: false }))).toBe(false);
  });

  it("offers neither once it is withdrawn", () => {
    const gone = row({ cancelledAt: GATES_SHUT.toISOString() });
    expect(canEnd(gone)).toBe(false);
    expect(canWithdraw(gone)).toBe(false);
  });

  it("does not offer ending a notice that has already been ended", () => {
    expect(canEnd(row({ kind: "dam_release_end" }))).toBe(false);
  });
});
