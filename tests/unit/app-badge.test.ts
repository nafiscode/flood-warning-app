import { afterEach, describe, expect, it, vi } from "vitest";
import { setIconBadge } from "@/lib/app-badge";

type Badged = { setAppBadge?: unknown; clearAppBadge?: unknown };
const nav = navigator as unknown as Badged;

afterEach(() => {
  delete nav.setAppBadge;
  delete nav.clearAppBadge;
});

describe("the number on Jaga's icon", () => {
  it("hands the system the unread count, and clears it at nought", () => {
    const set = vi.fn(async () => {});
    const clear = vi.fn(async () => {});
    nav.setAppBadge = set;
    nav.clearAppBadge = clear;
    setIconBadge(3);
    expect(set).toHaveBeenCalledWith(3);
    setIconBadge(0);
    expect(clear).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledTimes(1);
  });

  it("does nothing, and throws nothing, where the browser has no icon badge", () => {
    expect(() => setIconBadge(2)).not.toThrow();
  });

  it("a refusal (an iPhone without notification permission) is swallowed", async () => {
    nav.setAppBadge = vi.fn(() => Promise.reject(new Error("NotAllowedError")));
    expect(() => setIconBadge(1)).not.toThrow();
    await Promise.resolve();
  });
});
