import { describe, expect, it } from "vitest";
import { ringFor, type NoticeItem } from "@/lib/notices";

const alert = (id: string, level: string, source: string | null = null): NoticeItem =>
  ({
    kind: "alert",
    id: `alert:${id}`,
    at: "2026-11-20T01:00:00Z",
    places: [],
    level,
    hazard: "flood",
    reason: "",
    messages: { th: "x" },
    nextUpdateAt: "2026-11-20T04:00:00Z",
    source,
    alertId: id,
  }) as NoticeItem;
const ended = (id: string): NoticeItem =>
  ({
    kind: "alertEnded",
    id: `alert:${id}:ended`,
    at: "2026-11-20T02:00:00Z",
    places: [],
    level: "warning",
    hazard: "flood",
    messages: { th: "x" },
    alertId: id,
  }) as NoticeItem;

describe("when the app rings", () => {
  it("rings for a new Warning or Evacuate, and stays silent for Watch and Safe to return", () => {
    expect(ringFor([alert("a", "warning")], [], [])).toEqual({ sound: "alert", ids: ["alert:a"] });
    expect(ringFor([alert("a", "evacuate")], [], []).sound).toBe("alert");
    expect(ringFor([alert("a", "watch"), alert("b", "return")], [], []).sound).toBeNull();
  });

  it("uses the dam's own sound for a release notice, whatever its level, and before the plain one", () => {
    const dam = alert("d", "watch", "dam_release:bang_lang");
    expect(ringFor([dam], [], []).sound).toBe("damRelease");
    expect(ringFor([alert("a", "warning"), dam], [], [])).toEqual({
      sound: "damRelease",
      ids: ["alert:a", "alert:d"],
    });
  });

  it("rings once: not for what was read, not for what already rang, not for what was lifted", () => {
    const items = [alert("a", "warning")];
    expect(ringFor(items, ["alert:a"], []).sound).toBeNull();
    expect(ringFor(items, [], ["alert:a"]).sound).toBeNull();
    expect(ringFor([...items, ended("a")], [], []).sound).toBeNull();
  });

  it("is silent for an empty bell", () => {
    expect(ringFor([], [], [])).toEqual({ sound: null, ids: [] });
  });
});
