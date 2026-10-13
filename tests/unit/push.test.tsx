import { fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PushCardView } from "@/components/push/PushCard";
import {
  alertPayload,
  casePayload,
  clip,
  keyBytes,
  pushState,
  readPayload,
  type PushState,
} from "@/lib/push";
import en from "@/messages/en.json";
import ms from "@/messages/ms.json";
import th from "@/messages/th.json";
import { renderWithIntl } from "./render";

const ALERT = {
  id: "0b0e7c1e-0000-4000-8000-000000000001",
  level: "warning",
  messages: {
    th: "น้ำในแม่น้ำปัตตานีกำลังสูงขึ้น ย้ายของขึ้นที่สูง",
    ms: "Air sungai sedang naik.",
  },
};
const level = (l: string, locale: string) => `${l}/${locale}`;

describe("the notification for an alert", () => {
  it("carries the level and the reviewed words, in the phone's language", () => {
    const p = alertPayload(ALERT, "ms", level)!;
    expect(p.title).toBe("Jaga · warning/ms");
    expect(p.body).toBe("Air sungai sedang naik.");
    expect(p.url).toBe("/ms");
    expect(p.tag).toBe(`alert-${ALERT.id}`);
  });

  it("falls back to Thai, the language every alert has", () => {
    const p = alertPayload(ALERT, "en", level)!;
    expect(p.body).toBe(ALERT.messages.th);
    expect(p.url).toBe("/en");
    expect(alertPayload(ALERT, "th", level)!.url).toBe("/");
  });

  it("is never made for Normal, or for an alert with no words", () => {
    expect(alertPayload({ ...ALERT, level: "normal" }, "th", level)).toBeNull();
    expect(alertPayload({ ...ALERT, messages: {} }, "th", level)).toBeNull();
  });

  it("a long message is cut at a word and says it was cut", () => {
    const long = "คำ ".repeat(200);
    const cut = clip(long, 60);
    expect(cut.length).toBeLessThanOrEqual(60);
    expect(cut.endsWith("…")).toBe(true);
    expect(clip("  short   text ")).toBe("short text");
  });
});

describe("what the service worker accepts", () => {
  const good = alertPayload(ALERT, "th", level)!;

  it("its own message", () => {
    expect(readPayload(JSON.parse(JSON.stringify(good)))).toEqual(good);
  });

  it("nothing that is not an alert of a known level", () => {
    expect(readPayload(null)).toBeNull();
    expect(readPayload({ ...good, kind: "advert" })).toBeNull();
    expect(readPayload({ ...good, level: "normal" })).toBeNull();
    expect(readPayload({ ...good, title: 5 })).toBeNull();
  });

  it("a tap only ever opens a page of this app", () => {
    expect(readPayload({ ...good, url: "https://example.com/x" })!.url).toBe("/");
    expect(readPayload({ ...good, url: "//example.com" })!.url).toBe("/");
    expect(readPayload({ ...good, url: "/en" })!.url).toBe("/en");
  });
});

describe("whether this phone can be asked", () => {
  const base = {
    hasPush: true,
    permission: "default" as const,
    apple: false,
    standalone: false,
    subscribed: false,
  };

  it("an iPhone in a browser tab must be added to the home screen first", () => {
    expect(pushState({ ...base, apple: true, hasPush: false })).toBe("needsInstall");
    expect(pushState({ ...base, apple: true, standalone: true })).toBe("ask");
  });

  it("asks, is on, is blocked, or cannot", () => {
    expect(pushState(base)).toBe("ask");
    expect(pushState({ ...base, permission: "granted", subscribed: true })).toBe("on");
    // Allowed, but this browser holds no subscription yet: one tap finishes it.
    expect(pushState({ ...base, permission: "granted" })).toBe("ask");
    expect(pushState({ ...base, permission: "denied" })).toBe("blocked");
    expect(pushState({ ...base, hasPush: false })).toBe("unsupported");
  });

  it("the public key becomes the bytes the browser wants", () => {
    expect([...keyBytes("AQID-_8")]).toEqual([1, 2, 3, 251, 255]);
  });
});

describe("the card", () => {
  const view = (
    state: PushState | null,
    place: "home" | "account",
    hasArea = true,
    onEnable = () => {},
  ) =>
    renderWithIntl(
      <PushCardView
        state={state}
        place={place}
        hasArea={hasArea}
        busy={false}
        failed={false}
        onEnable={onEnable}
        onDisable={() => {}}
      />,
    ).container;

  it("asks only from a tap, and says the phone decides the sound", () => {
    const onEnable = vi.fn();
    const c = view("ask", "home", true, onEnable);
    expect(c.textContent).toContain(th.push.note);
    fireEvent.click(c.querySelector("[data-push-enable]")!);
    expect(onEnable).toHaveBeenCalledOnce();
  });

  it("stays off the home screen once on, when blocked, or with no area chosen", () => {
    expect(view("on", "home").innerHTML).toBe("");
    expect(view("blocked", "home").innerHTML).toBe("");
    expect(view("ask", "home", false).innerHTML).toBe("");
    expect(view("unsupported", "account").innerHTML).toBe("");
    expect(view(null, "home").innerHTML).toBe("");
  });

  it("an iPhone is told to add Jaga to the home screen first", () => {
    expect(view("needsInstall", "home").textContent).toContain(th.push.needsInstall);
  });

  it("on the Account page the state can always be read, and turned off", () => {
    const on = view("on", "account");
    expect(on.textContent).toContain(th.push.on);
    expect(on.querySelector("button")!.textContent).toBe(th.push.off);
    expect(view("blocked", "account").textContent).toContain(th.push.blocked);
    expect(view("ask", "account", false).textContent).toContain(th.push.noArea);
  });
});

describe("notifications about a request for help", () => {
  const words = th.push.send;
  const row = (kind: string, data: Record<string, unknown> = {}, locale = "th") => ({
    kind,
    sos_id: "0b0e7c1e-0000-4000-8000-000000000002",
    locale,
    data: { request: "rescue", tambon_th: "บานา", tambon_en: "Bana", ...data },
  });

  it("an offer names the tambon and the deadline in Thailand's time, and opens the board", () => {
    const p = casePayload(row("offer", { expires_at: "2026-11-20T07:05:00Z" }), words)!;
    expect(p.title).toBe(words.offerTitle.replace("{tambon}", "บานา"));
    expect(p.body).toContain("14:05");
    expect(p.url).toBe("/authority");
    expect(p.sticky).toBe(true);
    expect(p.tag).toBe("offer-0b0e7c1e-0000-4000-8000-000000000002");
  });

  it("a request for food and water is worded as one", () => {
    const p = casePayload(row("offer", { request: "supplies" }), words)!;
    expect(p.title).toBe(words.offerSuppliesTitle.replace("{tambon}", "บานา"));
  });

  it("the sender's steps name the team and open their own request, one notification per case", () => {
    const accepted = casePayload(row("accepted", { unit: "Yala rescue" }, "en"), words)!;
    expect(accepted.body).toContain("Yala rescue");
    expect(accepted.url).toBe("/en/sos/0b0e7c1e-0000-4000-8000-000000000002");
    const onWay = casePayload(row("en_route", { unit: "Yala rescue" }, "en"), words)!;
    expect(onWay.tag).toBe(accepted.tag);
    expect(accepted.sticky).toBe(false);
  });

  it("the admins are sent to the war room when nobody has accepted", () => {
    expect(casePayload(row("unclaimed"), words)!.url).toBe("/admin/war-room");
  });

  it("a case with no tambon still reads as a sentence, and an unknown kind is dropped", () => {
    const p = casePayload(row("offer", { tambon_th: null, tambon_en: null }), words)!;
    expect(p.title).toContain(words.somewhere);
    expect(casePayload(row("party"), words)).toBeNull();
    expect(casePayload({ ...row("offer"), sos_id: "../../admin" }, words)).toBeNull();
  });

  it("the service worker accepts them and keeps a tap inside the app", () => {
    const sent = casePayload(row("offer"), words)!;
    expect(readPayload(JSON.parse(JSON.stringify(sent)))).toEqual(sent);
    expect(readPayload({ ...sent, url: "https://example.com" })!.url).toBe("/");
  });

  it("every language has every line", () => {
    for (const other of [ms.push.send, en.push.send]) {
      expect(Object.keys(other).sort()).toEqual(Object.keys(words).sort());
    }
  });
});

describe("the card on a board and on a request's page", () => {
  const view = (state: PushState, place: "team" | "case") =>
    renderWithIntl(
      <PushCardView
        state={state}
        place={place}
        hasArea={false}
        busy={false}
        failed={false}
        onEnable={() => {}}
        onDisable={() => {}}
      />,
    ).container;

  it("asks in its own words without any area chosen, and gets out of the way once on", () => {
    expect(view("ask", "team").textContent).toContain(th.push.teamBody);
    expect(view("ask", "team").querySelector("[data-push-enable]")).toBeTruthy();
    expect(view("ask", "case").textContent).toContain(th.push.caseBody);
    expect(view("on", "team").innerHTML).toBe("");
    expect(view("blocked", "team").textContent).toContain(th.push.blocked);
  });
});
