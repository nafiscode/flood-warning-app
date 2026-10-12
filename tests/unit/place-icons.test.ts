import { describe, expect, it, vi } from "vitest";
import { HOUSE, placeIcon, placeIconName } from "@/lib/place-icons";

describe("the safe places' markers", () => {
  it("each kind and each ink has its own picture name, safe to use as an image id", () => {
    const day = placeIconName("place", "#1D3B53");
    expect(day).toBe("jaga-place-1D3B53");
    expect(placeIconName("parking", "#1D3B53")).not.toBe(day);
    expect(placeIconName("place", "rgb(230, 237, 241)")).toBe("jaga-place-rgb230237241");
  });

  it("the house stays inside the square", () => {
    for (const [x, y] of HOUSE) {
      expect(x).toBeGreaterThan(0.1);
      expect(x).toBeLessThan(0.9);
      expect(y).toBeGreaterThan(0.1);
      expect(y).toBeLessThan(0.9);
    }
  });

  it("gives no picture, and does not throw, where there is no canvas to draw on", () => {
    const none = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    expect(placeIcon("place", "#1D3B53", "#ffffff")).toBeNull();
    none.mockRestore();
  });
});
