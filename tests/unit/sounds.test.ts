import { describe, expect, it } from "vitest";
import { ALERT_MIN_MS, durationMs, SOUNDS, soundForAlertLevel, type SoundName } from "@/lib/sounds";

const ALERTS: SoundName[] = ["alertWatch", "alertWarning", "alertEvacuate", "alertReturn"];
const NAMES: SoundName[] = ["offer", "supplyOffer", "accepted", "rescued", ...ALERTS, "damRelease"];

describe("Jaga's sounds", () => {
  it("has the nine in docs/brand.md and no more", () => {
    // One alert sound per level since 13 October (the owner). Another needs a decision, not a
    // commit.
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

  it("keeps the private sounds short: a signal rather than a tune", () => {
    for (const name of NAMES.filter((n) => !ALERTS.includes(n))) {
      expect(durationMs(name)).toBeLessThanOrEqual(1200);
    }
  });

  it("makes every alert sound at least five seconds long, and not much longer", () => {
    for (const name of ALERTS) {
      expect(durationMs(name)).toBeGreaterThanOrEqual(ALERT_MIN_MS);
      expect(durationMs(name)).toBeLessThanOrEqual(7000);
    }
  });

  it("gives each alert level a sound of its own", () => {
    const shapes = ALERTS.map((n) =>
      SOUNDS[n].tones.map((t) => `${t.freq}@${t.at}/${t.ms}`).join(","),
    );
    expect(new Set(shapes).size).toBe(ALERTS.length);
    // And the level is in the pitch, not only the rhythm: no two share their set of notes.
    const notes = ALERTS.map((n) => [...new Set(SOUNDS[n].tones.map((t) => t.freq))].join(","));
    expect(new Set(notes).size).toBe(ALERTS.length);
  });

  it("makes Evacuate the most insistent alert, and never as fast as the teams' alarm", () => {
    const busy = (n: SoundName) =>
      SOUNDS[n].tones.reduce((sum, t) => sum + t.ms, 0) / durationMs(n);
    for (const name of ALERTS.filter((n) => n !== "alertEvacuate")) {
      expect(busy("alertEvacuate")).toBeGreaterThan(busy(name));
    }
    const shortest = (n: SoundName) => Math.min(...SOUNDS[n].tones.map((t) => t.ms));
    expect(shortest("alertEvacuate")).toBeGreaterThan(shortest("offer") * 3);
  });

  it("is the fast two-tone the owner chose by ear: six notes, high and low in turn, then a breath", () => {
    const alarm = SOUNDS.offer;
    expect(alarm.tones.map((t) => t.freq)).toEqual([988, 740, 988, 740, 988, 740]);
    expect(alarm.tones.every((t) => t.type === "triangle")).toBe(true);
    // The notes are over well before the next round starts, so each round is heard apart.
    expect(durationMs("offer")).toBeLessThan(alarm.repeatEveryMs! - 300);
    expect(alarm.repeatEveryMs).toBe(1300);
    expect(alarm.vibrate).toHaveLength(7);
  });

  it("gives the dam release a shape of its own, never mistakable for an alert", () => {
    const dam = SOUNDS.damRelease.tones.map((t) => t.freq);
    const warning = SOUNDS.alertWarning.tones.map((t) => t.freq);
    // The Warning is one low note, struck in pairs; the dam release rises. That difference is
    // the point.
    expect(new Set(warning).size).toBe(1);
    expect(dam[0]).toBeLessThan(dam[dam.length - 1]!);
    for (const name of ALERTS) {
      expect([...new Set(SOUNDS[name].tones.map((t) => t.freq))]).not.toEqual([...new Set(dam)]);
    }
  });

  it("says good news with a rising shape and an ending with a falling one", () => {
    const accepted = SOUNDS.accepted.tones.map((t) => t.freq);
    const rescued = SOUNDS.rescued.tones.map((t) => t.freq);
    expect(accepted[0]).toBeLessThan(accepted[accepted.length - 1]!);
    expect(rescued[0]).toBeGreaterThan(rescued[rescued.length - 1]!);
  });
});

describe("which alert level makes a sound", () => {
  it("is silent for Normal, which is the absence of an alert", () => {
    expect(soundForAlertLevel("normal")).toBeNull();
  });

  it("sounds for every level an admin can issue (the owner, 13 Oct)", () => {
    expect(soundForAlertLevel("watch")).toBe("alertWatch");
    expect(soundForAlertLevel("warning")).toBe("alertWarning");
    expect(soundForAlertLevel("evacuate")).toBe("alertEvacuate");
    expect(soundForAlertLevel("return")).toBe("alertReturn");
  });

  it("stays silent for a level it does not know", () => {
    expect(soundForAlertLevel("something_new")).toBeNull();
  });
});
