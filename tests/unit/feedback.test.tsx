import { describe, expect, it } from "vitest";
import {
  answersShort,
  ASK_GAP_MS,
  askAllowed,
  canBePublic,
  EMPTY_FEEDBACK,
  hasAnswer,
  IMPROVE,
  LIKED,
  outcomeText,
  quietScreen,
  RATINGS,
  screenCode,
  toggle,
} from "@/lib/feedback";
import { isFeedbackWord, readPress } from "@/lib/line";
import en from "@/messages/en.json";
import ms from "@/messages/ms.json";
import th from "@/messages/th.json";

/*
 * A15 (spec 17). These are the rules that decide whether the app asks somebody to rate it, which
 * is the part that can do harm: an invitation on the wrong screen, or at the wrong moment, puts
 * something between a person and help.
 */

describe("when the app may ask at all", () => {
  const now = Date.UTC(2026, 10, 1);

  it("never while a place of theirs is at Warning or Evacuate", () => {
    expect(askAllowed({ tense: true, quietScreen: false, shownAt: null, now })).toBe(false);
    // ...and that overrides a moment that would otherwise be perfectly fine.
    expect(
      askAllowed({ tense: true, quietScreen: false, shownAt: now - 10 * ASK_GAP_MS, now }),
    ).toBe(false);
  });

  it("never on an SOS, food-and-water, report or alert screen", () => {
    expect(askAllowed({ tense: false, quietScreen: true, shownAt: null, now })).toBe(false);
    for (const path of [
      "/sos",
      "/sos/abc",
      "/supplies",
      "/report",
      "/flood",
      "/flood/950101",
    ]) {
      expect(quietScreen(path), path).toBe(true);
    }
  });

  it("allows the pages where somebody reads how a request went, and the page itself", () => {
    // "Never while a request is open" is the caller's `when`, not the address: My requests and a
    // team's own page carry the ask once nothing of theirs is still open.
    for (const path of ["/", "/requests", "/authority/team", "/account", "/feedback", "/map"]) {
      expect(quietScreen(path), path).toBe(false);
    }
  });

  it("asks once, then not again for 30 days", () => {
    expect(askAllowed({ tense: false, quietScreen: false, shownAt: null, now })).toBe(true);
    expect(askAllowed({ tense: false, quietScreen: false, shownAt: now - 1000, now })).toBe(false);
    expect(
      askAllowed({ tense: false, quietScreen: false, shownAt: now - ASK_GAP_MS + 1, now }),
    ).toBe(false);
    expect(askAllowed({ tense: false, quietScreen: false, shownAt: now - ASK_GAP_MS, now })).toBe(
      true,
    );
  });

  it("does not let a clock moved backwards open the gate", () => {
    expect(askAllowed({ tense: false, quietScreen: false, shownAt: now + 60_000, now })).toBe(
      false,
    );
  });
});

describe("the form", () => {
  it("has nothing required: an empty form is not an error", () => {
    expect(hasAnswer(EMPTY_FEEDBACK)).toBe(false);
    expect(hasAnswer({ ...EMPTY_FEEDBACK, rating: 3 })).toBe(true);
    expect(hasAnswer({ ...EMPTY_FEEDBACK, liked: ["risk_map"] })).toBe(true);
    expect(hasAnswer({ ...EMPTY_FEEDBACK, improveNote: "the map is small" })).toBe(true);
    expect(hasAnswer({ ...EMPTY_FEEDBACK, improveNote: "   " })).toBe(false);
  });

  it("offers the public page only once there are words to show", () => {
    expect(canBePublic(EMPTY_FEEDBACK)).toBe(false);
    expect(canBePublic({ ...EMPTY_FEEDBACK, rating: 5 })).toBe(false);
    expect(canBePublic({ ...EMPTY_FEEDBACK, liked: ["risk_map"] })).toBe(false);
    expect(canBePublic({ ...EMPTY_FEEDBACK, likedNote: "it warned me" })).toBe(true);
    expect(canBePublic({ ...EMPTY_FEEDBACK, improveNote: "too late" })).toBe(true);
  });

  it("turns a chip on and off without disturbing the rest", () => {
    expect(toggle([], "risk_map")).toEqual(["risk_map"]);
    expect(toggle(["risk_map", "hotlines"], "risk_map")).toEqual(["hotlines"]);
    expect(toggle(["risk_map"], "other")).toEqual(["risk_map", "other"]);
  });
});

describe("the chip lists", () => {
  it("offers both directions a warning system fails in", () => {
    // Spec 17 is explicit about this pair: only the people living there can say which way it is
    // failing, and dropping either one would make the figures flattering.
    expect(IMPROVE).toContain("late_warning");
    expect(IMPROVE).toContain("too_many_warnings");
  });

  it("ends each list in 'other', and nowhere else", () => {
    for (const list of [LIKED, IMPROVE]) {
      expect(list.at(-1)).toBe("other");
      expect(list.filter((c) => c === "other")).toHaveLength(1);
    }
  });

  it("has a stable code and words in all three languages for every chip", () => {
    for (const [name, list] of [
      ["liked", LIKED],
      ["improve", IMPROVE],
    ] as const) {
      for (const code of list) {
        expect(code, code).toMatch(/^[a-z_]{2,40}$/);
        for (const [locale, messages] of [
          ["th", th],
          ["ms", ms],
          ["en", en],
        ] as const) {
          const words = (messages.feedback.chips as Record<string, Record<string, string>>)[name]!;
          expect(words[code], `${locale} ${name}.${code}`).toBeTruthy();
        }
      }
    }
  });

  it("has a word under every face, in all three languages", () => {
    for (const messages of [th, ms, en]) {
      for (const n of RATINGS) {
        expect((messages.feedback.words as Record<string, string>)[String(n)]).toBeTruthy();
      }
    }
  });
});

describe("the screen a rating is about", () => {
  it("drops the language prefix and any id, so two place pages are one screen", () => {
    expect(screenCode("/th/")).toBe("/");
    expect(screenCode("/en/map")).toBe("/map");
    expect(screenCode("/ms/flood/950101")).toBe("/flood/:id");
    expect(screenCode("/flood/940201")).toBe("/flood/:id");
    expect(screenCode("/sos/0f1b2c3d-4e5f-6789-abcd-0123456789ab")).toBe("/sos/:id");
    expect(screenCode("/requests/")).toBe("/requests");
  });
});

describe("the published figures", () => {
  it("says how many answers a period is still short of", () => {
    expect(answersShort({ answers: 12, minAnswers: 20 })).toBe(8);
    expect(answersShort({ answers: 20, minAnswers: 20 })).toBe(0);
    expect(answersShort({ answers: 31, minAnswers: 20 })).toBe(0);
  });

  it("reads what was done about a weak point in the reader's language, falling back to Thai", () => {
    const done = { th: "ทำแล้ว", en: "Done" };
    expect(outcomeText(done, "en")).toBe("Done");
    expect(outcomeText(done, "ms")).toBe("ทำแล้ว");
    expect(outcomeText(null, "th")).toBeNull();
    expect(outcomeText({}, "th")).toBeNull();
  });
});

describe("in LINE", () => {
  it("reads the feedback question and the five faces, and nothing else", () => {
    expect(readPress("feedback")).toEqual({ kind: "feedback" });
    expect(readPress("feedback:4")).toEqual({ kind: "rated", rating: 4 });
    expect(readPress("feedback:0").kind).toBe("other");
    expect(readPress("feedback:6").kind).toBe("other");
    expect(readPress("feedback:4x").kind).toBe("other");
    // The older buttons still work.
    expect(readPress("status")).toEqual({ kind: "status" });
    expect(readPress("rescue:0f1b2c3d-4e5f-6789-abcd-0123456789ab:yes").kind).toBe("rescue");
  });

  it("answers a plain word, and never mistakes something about the water for one", () => {
    for (const word of ["feedback", "Rate", "ความเห็น", "ให้คะแนน", "pendapat", " nilai "]) {
      expect(isFeedbackWord(word), word).toBe(true);
    }
    for (const other of [
      "น้ำขึ้นแล้ว",
      "the water is rising",
      "feedback: the map is hard to read",
      "help",
      "",
      null,
    ]) {
      expect(isFeedbackWord(other), String(other)).toBe(false);
    }
  });
});

describe("the words themselves", () => {
  it("says on the public page that these are opinions of the app, not flood information", () => {
    for (const messages of [th, ms, en]) {
      expect(messages.feedback.comments.notFlood.length).toBeGreaterThan(20);
      expect(messages.feedback.notFlood.length).toBeGreaterThan(20);
    }
    expect(en.feedback.comments.notFlood).toContain("not flood information");
  });

  it("keeps the two consents apart in words, and says what each one does", () => {
    for (const messages of [th, ms, en]) {
      const form = messages.feedback.form;
      expect(form.contactOk).not.toBe(form.publicOk);
      expect(form.contactHint.length).toBeGreaterThan(20);
      expect(form.publicHint.length).toBeGreaterThan(20);
    }
  });

  it("prints the refusal rules on the admin screen rather than hiding them in a document", () => {
    for (const messages of [th, ms, en]) {
      expect(messages.adminFeedback.publish.rules.length).toBeGreaterThan(120);
    }
    expect(en.adminFeedback.publish.rules).toContain("flooding");
  });
});
