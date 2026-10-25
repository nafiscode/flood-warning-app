import { describe, expect, it } from "vitest";
import { gaugeImageName, gaugeLabels, seaLook } from "@/lib/gauge-marks";
import { toGauge, withSea } from "@/lib/map-data";

const gauge = (code: string) =>
  toGauge({ id: code, code, name: {}, lat: 6, lon: 101, status: "normal", value: 1 });

describe("the sea beside a tidal gauge", () => {
  it("lays the sea word onto the gauge with that code, and onto no other", () => {
    const out = withSea(
      [gauge("A"), gauge("B")],
      [{ code: "A", state: "shut", shut_from: "2026-10-26T17:00:00Z", shut_days: 3, issued_at: "2026-10-25T05:00:00Z" }],
    );
    expect(out[0]?.sea).toEqual({
      state: "shut",
      shutFrom: "2026-10-26T17:00:00Z",
      shutDays: 3,
      issuedAt: "2026-10-25T05:00:00Z",
    });
    expect(out[1]?.sea).toBeUndefined();
  });

  it("reads an unknown word as unknown, and an unreadable answer as no sea at all", () => {
    expect(withSea([gauge("A")], [{ code: "A", state: "calm!" }])[0]?.sea?.state).toBe("unknown");
    expect(withSea([gauge("A")], null)[0]?.sea).toBeUndefined();
  });

  it("draws nothing for an unknown sea: a missing forecast is not calm", () => {
    expect(seaLook(undefined)).toBe("none");
    expect(seaLook({ state: "unknown", shutFrom: null, shutDays: 0, issuedAt: null })).toBe("none");
    expect(seaLook({ state: "open", shutFrom: null, shutDays: 0, issuedAt: null })).toBe("open");
  });

  it("writes the sea on the map only when it is shut", () => {
    const words = { near: "near", over: "over", seaShut: "sea held" };
    const at = (state: "open" | "narrowing" | "shut") => ({
      value: 3.1,
      status: "normal" as const,
      sea: { state, shutFrom: null, shutDays: 0, issuedAt: null },
    });
    expect(gaugeLabels(at("shut"), words)).toEqual({ short: "sea held", long: "3.10 m · sea held" });
    expect(gaugeLabels(at("narrowing"), words).long).toBe("3.10 m");
    expect(gaugeLabels(at("open"), words).short).toBe("");
  });

  it("keeps a picture per sea look", () => {
    expect(gaugeImageName("normal", "flat", false, "shut")).not.toBe(gaugeImageName("normal", "flat", false));
  });
});
