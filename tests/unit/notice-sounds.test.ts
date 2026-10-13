import { describe, expect, it } from "vitest";
import { ringForAll } from "@/lib/notice-sounds";
import type { NoticeItem } from "@/lib/notices";
import { announcementPayload, readPayload } from "@/lib/push";
import { ALERT_MIN_MS, durationMs, SOUNDS } from "@/lib/sounds";

const item = (kind: string, id: string, more: Record<string, unknown> = {}): NoticeItem =>
  ({ kind, id, at: "2026-11-20T01:00:00Z", places: [], ...more }) as unknown as NoticeItem;
const alert = (id: string, level: string) =>
  item("alert", `alert:${id}`, {
    level,
    hazard: "flood",
    reason: "",
    messages: { th: "x" },
    nextUpdateAt: "2026-11-20T04:00:00Z",
    source: null,
    alertId: id,
  });
const announcement = (id: string) => item("announcement", `ann:${id}`, { messages: { th: "x" } });
const caseStep = (event: string) => item("sos", `sos:1:${event}`, { caseId: "1", event });

describe("every new item in the bell is heard once (owner, 13 Oct)", () => {
  it("an announcement has its own sound, and it is not an alert's", () => {
    const due = ringForAll([announcement("a")], [], []);
    expect(due).toEqual({ sound: "announcement", ids: ["ann:a"] });
  });

  it("a step of one's own request sounds like the request's page does", () => {
    expect(ringForAll([caseStep("accepted")], [], []).sound).toBe("accepted");
    expect(ringForAll([caseStep("en_route")], [], []).sound).toBe("accepted");
    expect(ringForAll([caseStep("rescued")], [], []).sound).toBe("rescued");
  });

  it("anything else gets the two quiet notes: an alert that has ended, news of one's team", () => {
    const ended = item("alertEnded", "alert:x:ended", { alertId: "x", level: "warning" });
    expect(ringForAll([ended], [], []).sound).toBe("notice");
    expect(ringForAll([item("unit", "unit:1", { event: "verified" })], [], []).sound).toBe(
      "notice",
    );
  });

  it("an alert always wins, so good news can never cover a warning", () => {
    const due = ringForAll(
      [announcement("a"), alert("w", "warning"), caseStep("accepted")],
      [],
      [],
    );
    expect(due.sound).toBe("alertWarning");
    // One sound answers for all three: none of them rings again.
    expect(due.ids.sort()).toEqual(["alert:w", "ann:a", "sos:1:accepted"]);
  });

  it("what was read or already rung is silent", () => {
    expect(ringForAll([announcement("a")], ["ann:a"], []).sound).toBeNull();
    expect(ringForAll([announcement("a")], [], ["ann:a"]).sound).toBeNull();
    expect(ringForAll([announcement("a"), announcement("b")], ["ann:a"], []).ids).toEqual([
      "ann:b",
    ]);
  });
});

describe("the announcement sound is positive, not an alarm", () => {
  const notes = SOUNDS.announcement.tones.map((t) => t.freq);

  it("rises all the way, plays once, and is short", () => {
    expect([...notes].sort((a, b) => a - b)).toEqual(notes);
    expect(SOUNDS.announcement.repeatEveryMs).toBeNull();
    expect(durationMs("announcement")).toBeLessThan(ALERT_MIN_MS / 3);
  });

  it("shares its shape with no alert sound", () => {
    for (const name of ["alertWatch", "alertWarning", "alertEvacuate", "alertReturn"] as const) {
      expect(SOUNDS[name].tones.map((t) => t.freq)).not.toEqual(notes);
    }
  });
});

describe("an announcement as a phone notification", () => {
  const a = { id: "0b0e7c1e-0000-4000-8000-000000000003", messages: { th: "ประกาศ", ms: "Umum" } };

  it("carries its own reviewed words in the phone's language, Thai where there is no other", () => {
    expect(announcementPayload(a, "ms", "T")).toMatchObject({ body: "Umum", url: "/ms" });
    expect(announcementPayload(a, "en", "T")).toMatchObject({ body: "ประกาศ", url: "/en" });
    expect(announcementPayload({ ...a, messages: {} }, "th", "T")).toBeNull();
  });

  it("is accepted by the service worker", () => {
    const sent = announcementPayload(a, "th", "ประกาศจาก Jaga")!;
    expect(readPayload(JSON.parse(JSON.stringify(sent)))).toEqual(sent);
  });
});
