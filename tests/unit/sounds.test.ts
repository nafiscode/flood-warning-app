import { describe, expect, it } from "vitest";
import { durationMs, SOUNDS, soundForAlertLevel, type SoundName } from "@/lib/sounds";

const NAMES: SoundName[] = ["offer", "accepted", "rescued", "alert", "damRelease"];

describe("Jaga's sounds", () => {
  it("has five and no more", () => {
    // docs/brand.md: five sounds and no others. A sixth needs a decision, not a commit.
    expect(Object.keys(SOUNDS).sort()).toEqual([...NAMES].sort());
  });

  it("gives every sound a vibration pattern, so sound is never the only channel", () => {
    for (const name of NAMES) {
      expect(SOUNDS[name].vibrate.length).toBeGreaterThan(0);
      expect(SOUNDS[name].vibrate.every((ms) => ms > 0)).toBe(true);
    }
  });

  it("repeats only the two sounds that should", () => {
    // The responder's alarm, until it is answered; and a dam release, because the water is coming.
    const repeating = NAMES.filter((n) => SOUNDS[n].repeatEveryMs !== null);
    expect(repeating.sort()).toEqual(["damRelease", "offer"]);
  });

  it("never starts a repeat before the sound itself has finished", () => {
    for (const name of NAMES) {
      const gap = SOUNDS[name].repeatEveryMs;
      if (gap !== null) expect(gap).toBeGreaterThan(durationMs(name));
    }
  });

  it("keeps every sound short enough to be a signal rather than a tune", () => {
    for (const name of NAMES) {
      expect(durationMs(name)).toBeLessThanOrEqual(1200);
    }
  });

  it("makes the alarm the most insistent of them", () => {
    const alarm = SOUNDS.offer;
    for (const name of NAMES.filter((n) => n !== "offer")) {
      expect(alarm.tones.length).toBeGreaterThanOrEqual(SOUNDS[name].tones.length);
    }
  });

  it("gives the dam release a shape of its own, never mistakable for an alert", () => {
    const dam = SOUNDS.damRelease.tones.map((t) => t.freq);
    const alert = SOUNDS.alert.tones.map((t) => t.freq);
    expect(dam).not.toEqual(alert);
    // The alert is one note twice; the dam release rises. That difference is the point.
    expect(new Set(alert).size).toBe(1);
    expect(dam[0]).toBeLessThan(dam[dam.length - 1]!);
  });

  it("says good news with a rising shape and an ending with a falling one", () => {
    const accepted = SOUNDS.accepted.tones.map((t) => t.freq);
    const rescued = SOUNDS.rescued.tones.map((t) => t.freq);
    expect(accepted[0]).toBeLessThan(accepted[accepted.length - 1]!);
    expect(rescued[0]).toBeGreaterThan(rescued[rescued.length - 1]!);
  });
});

describe("which alert level makes a sound", () => {
  it("is silent for Normal, Watch and Return", () => {
    // "get ready" does not deserve a noise at three in the morning (docs/brand.md).
    expect(soundForAlertLevel("normal")).toBeNull();
    expect(soundForAlertLevel("watch")).toBeNull();
    expect(soundForAlertLevel("return")).toBeNull();
  });

  it("sounds for Warning and Evacuate", () => {
    expect(soundForAlertLevel("warning")).toBe("alert");
    expect(soundForAlertLevel("evacuate")).toBe("alert");
  });

  it("stays silent for a level it does not know", () => {
    expect(soundForAlertLevel("something_new")).toBeNull();
  });
});
