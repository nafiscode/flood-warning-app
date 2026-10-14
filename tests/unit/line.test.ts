import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { lineQuotaLevel } from "@/components/admin/LineQuota";
import {
  alertFlex,
  answerText,
  batches,
  caseLineMessage,
  LINE_LABEL_MAX,
  lineTime,
  personalBody,
  readPress,
  statusText,
  type LineWords,
} from "@/lib/line";
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

  it("says 'your area' where the app lists the alert's tambons, and how many it covers", () => {
    const template = {
      th: "กลับบ้านได้ในพื้นที่ {area} กลับอย่างระมัดระวัง",
      ms: "Selamat pulang di {area}. Pulang dengan berhati-hati.",
      en: "It is safe to return in {area}. Go back carefully.",
    };
    const listed = {
      ...ALERT,
      messages: {
        th: "กลับบ้านได้ในพื้นที่ ต.บ่อยาง, ต.เขารูปช้าง และอีก 375 ตำบล กลับอย่างระมัดระวัง",
      },
      template,
      tambons: 377,
    };
    const thai = JSON.stringify(alertFlex(listed, "th", "กลับบ้านได้", th.line, "https://x"));
    expect(thai).toContain("กลับบ้านได้ในพื้นที่ของคุณ กลับอย่างระมัดระวัง");
    expect(thai).not.toContain("ต.บ่อยาง");
    expect(thai).toContain("377");
    expect(personalBody(template, "ms", ms.line.yourArea)).toBe(
      "Selamat pulang di kawasan anda. Pulang dengan berhati-hati.",
    );
    expect(personalBody(template, "en", en.line.yourArea)).toBe(
      "It is safe to return in your area. Go back carefully.",
    );
    // One tambon: "your area" says it all, so no line about how many.
    const one = JSON.stringify(
      alertFlex({ ...listed, tambons: 1 }, "en", "Return", en.line, "https://x"),
    );
    expect(one).not.toContain(en.line.covers.slice(0, 16));
  });

  it("keeps the stored words for an alert not made from a template", () => {
    expect(personalBody(null, "th", th.line.yourArea)).toBeNull();
    expect(personalBody({ th: "ไม่มีชื่อพื้นที่" }, "th", th.line.yourArea)).toBeNull();
    const flex = JSON.stringify(
      alertFlex({ ...ALERT, template: null }, "th", "เตือนภัย", words, "https://x"),
    );
    expect(flex).toContain(ALERT.messages.th);
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

describe("a request for help in LINE", () => {
  const row = (kind: string, data: Record<string, unknown> = {}) => ({
    kind,
    sos_id: "0b0e7c1e-0000-4000-8000-00000000000a",
    locale: "th",
    data: { request: "rescue", tambon_th: "บานา", tambon_en: "Bana", unit: "Yala rescue", ...data },
  });

  it("the offer to a team names the tambon and opens the board, nothing about the person", () => {
    const m = caseLineMessage(row("offer"), th.push.send, words, "https://jaga.example")!;
    const text = JSON.stringify(m);
    expect(text).toContain("บานา");
    expect(text).toContain('"uri":"https://jaga.example/authority"');
    expect(text).toContain(words.openBoard);
  });

  it("the sender's question carries two buttons whose presses name this request", () => {
    const m = caseLineMessage(row("rescued"), th.push.send, words, "https://x") as {
      template: { type: string; text: string; actions: { data: string; label: string }[] };
    };
    expect(m.template.type).toBe("confirm");
    expect(m.template.text).toContain("Yala rescue");
    expect(m.template.actions.map((a) => a.data)).toEqual([
      "rescue:0b0e7c1e-0000-4000-8000-00000000000a:yes",
      "rescue:0b0e7c1e-0000-4000-8000-00000000000a:no",
    ]);
    const supplies = caseLineMessage(
      row("rescued", { request: "supplies" }),
      th.push.send,
      words,
      "https://x",
    ) as {
      template: { actions: { label: string }[] };
    };
    expect(supplies.template.actions[0]!.label).toBe(words.confirmYesSupplies);
  });

  it("nothing is made for a kind LINE does not carry, or a broken case id", () => {
    expect(caseLineMessage(row("en_route"), th.push.send, words, "https://x")).toBeNull();
    expect(
      caseLineMessage({ ...row("rescued"), sos_id: "x" }, th.push.send, words, "https://x"),
    ).toBeNull();
  });

  it("every button label fits LINE's limit of 20 characters, in every language", () => {
    for (const lang of [th.line, ms.line, en.line]) {
      for (const key of [
        "openBoard",
        "confirmYes",
        "confirmNo",
        "confirmYesSupplies",
        "confirmNoSupplies",
      ] as const) {
        expect([...lang[key]].length, `${key}: ${lang[key]}`).toBeLessThanOrEqual(LINE_LABEL_MAX);
      }
    }
  });

  it("a press is read strictly: the menu's status, or yes or no for one request", () => {
    expect(readPress("status")).toEqual({ kind: "status" });
    expect(readPress("rescue:0b0e7c1e-0000-4000-8000-00000000000a:no")).toEqual({
      kind: "rescue",
      sos: "0b0e7c1e-0000-4000-8000-00000000000a",
      rescued: false,
    });
    expect(readPress("rescue:../../x:yes")).toEqual({ kind: "other" });
    expect(readPress(undefined)).toEqual({ kind: "other" });
  });

  it("the chat says what the press did", () => {
    expect(answerText("confirmed", words)).toBe(words.answeredYes);
    expect(answerText("disputed", words)).toBe(words.answeredNo);
    expect(answerText("closed", words)).toBe(words.answeredClosed);
    expect(answerText("not_yours", words)).toBe(words.answeredNotYours);
  });
});

describe("the admins' LINE quota line", () => {
  it("is quiet with room, warns from 70%, and says when the month is spent", () => {
    expect(lineQuotaLevel(100, 500)).toBe("ok");
    expect(lineQuotaLevel(350, 500)).toBe("70");
    expect(lineQuotaLevel(450, 500)).toBe("90");
    expect(lineQuotaLevel(500, 500)).toBe("full");
    expect(lineQuotaLevel(10, 0)).toBe("ok");
  });
});
