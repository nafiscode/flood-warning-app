import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { alertFlex, batches, lineTime, statusText, type LineWords } from "@/lib/line";
import { lineSignatureOk } from "@/lib/line-server";
import en from "@/messages/en.json";
import ms from "@/messages/ms.json";
import th from "@/messages/th.json";

const words: LineWords = th.line;
const ALERT = {
  id: "0b0e7c1e-0000-4000-8000-000000000009",
  level: "warning",
  messages: { th: "น้ำในแม่น้ำปัตตานีกำลังสูงขึ้น", ms: "Air sungai sedang naik." },
  nextUpdateAt: "2026-11-20T07:05:00Z",
};

describe("an alert as a LINE message", () => {
  it("says the level in words on its own colour, the reviewed message, the next update and a way in", () => {
    const flex = alertFlex(ALERT, "th", "เตือนภัย", words, "https://jaga.example")!;
    const text = JSON.stringify(flex);
    expect(flex.altText).toContain("เตือนภัย");
    expect(text).toContain(ALERT.messages.th);
    // The Warning colour of the alert palette, with the level written out beside it.
    expect(text).toContain("#F07F1A");
    expect(text).toContain("20/11 14:05");
    expect(text).toContain('"uri":"https://jaga.example/"');
  });

  it("uses the person's language, Thai where the alert has no other", () => {
    expect(JSON.stringify(alertFlex(ALERT, "ms", "Amaran", ms.line, "https://x"))).toContain(
      "Air sungai sedang naik.",
    );
    const english = JSON.stringify(alertFlex(ALERT, "en", "Warning", en.line, "https://x"));
    expect(english).toContain(ALERT.messages.th);
    expect(english).toContain("https://x/en");
  });

  it("is never made for Normal or for an alert with no words", () => {
    expect(alertFlex({ ...ALERT, level: "normal" }, "th", "ปกติ", words, "https://x")).toBeNull();
    expect(alertFlex({ ...ALERT, messages: {} }, "th", "เตือนภัย", words, "https://x")).toBeNull();
  });

  it("goes out in groups LINE accepts, each person once", () => {
    const ids = Array.from({ length: 1201 }, (_, i) => `U${i}`);
    const groups = batches([...ids, "U0", "U1"]);
    expect(groups.map((g) => g.length)).toEqual([500, 500, 201]);
  });

  it("a broken time is left out rather than printed", () => {
    expect(lineTime("not a time")).toBe("");
    expect(lineTime(null)).toBe("");
  });
});

describe("the answer to someone asking for their area's status", () => {
  const level = (l: string) => (th.alert.level as Record<string, string>)[l] ?? l;

  it("no alert is never worded as no risk, and the hotlines are there", () => {
    const text = statusText({ known: true, hasPlaces: true, alerts: [] }, "th", level, words);
    expect(text).toBe(words.statusNone);
    expect(text).toContain("1784");
    expect(text).toContain("ไม่ได้หมายความว่าไม่มีความเสี่ยง");
  });

  it("someone Jaga does not know, or with no places set, is told what to do", () => {
    expect(statusText({ known: false, hasPlaces: false, alerts: [] }, "th", level, words)).toBe(
      words.statusUnknown,
    );
    expect(statusText({ known: true, hasPlaces: false, alerts: [] }, "th", level, words)).toBe(
      words.statusNoPlaces,
    );
  });

  it("alerts in force are listed with their level in words", () => {
    const text = statusText(
      {
        known: true,
        hasPlaces: true,
        alerts: [{ level: "evacuate", messages: { th: "อพยพทันที" }, next_update_at: null }],
      },
      "th",
      level,
      words,
    );
    expect(text).toContain("อพยพ");
    expect(text).toContain("อพยพทันที");
  });

  it("every language has every line", () => {
    for (const other of [ms.line, en.line]) {
      expect(Object.keys(other).sort()).toEqual(Object.keys(words).sort());
    }
  });
});

describe("LINE's signature on a webhook", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("only the exact bytes signed with the channel secret pass", () => {
    vi.stubEnv("LINE_MESSAGING_CHANNEL_SECRET", "test-secret");
    const body = JSON.stringify({ events: [] });
    const good = createHmac("sha256", "test-secret").update(body).digest("base64");
    expect(lineSignatureOk(body, good)).toBe(true);
    expect(lineSignatureOk(`${body} `, good)).toBe(false);
    expect(lineSignatureOk(body, "AAAA")).toBe(false);
    expect(lineSignatureOk(body, null)).toBe(false);
  });

  it("with no secret on the server nothing passes", () => {
    vi.stubEnv("LINE_MESSAGING_CHANNEL_SECRET", "");
    const body = "{}";
    expect(lineSignatureOk(body, createHmac("sha256", "").update(body).digest("base64"))).toBe(
      false,
    );
  });
});
