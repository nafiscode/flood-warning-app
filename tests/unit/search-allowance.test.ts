import { beforeEach, describe, expect, it } from "vitest";
import { allowSearch, forgetSearches } from "@/lib/search-allowance";

beforeEach(forgetSearches);

describe("searches a visitor may make", () => {
  it("allows a handful a minute and then asks to wait", () => {
    const start = 1_000_000;
    const answers = Array.from({ length: 14 }, (_, i) => allowSearch("1.2.3.4", start + i));
    expect(answers.filter(Boolean)).toHaveLength(12);
    expect(answers.slice(12)).toEqual([false, false]);
  });

  it("counts each address on its own", () => {
    for (let i = 0; i < 12; i += 1) allowSearch("1.2.3.4", 5_000 + i);
    expect(allowSearch("1.2.3.4", 5_100)).toBe(false);
    expect(allowSearch("5.6.7.8", 5_100)).toBe(true);
  });

  it("lets the same address search again once the minute has passed", () => {
    for (let i = 0; i < 12; i += 1) allowSearch("1.2.3.4", 10_000 + i);
    expect(allowSearch("1.2.3.4", 10_100)).toBe(false);
    expect(allowSearch("1.2.3.4", 10_000 + 61_000)).toBe(true);
  });
});
