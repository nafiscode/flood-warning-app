import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { thaiTime, ThaiClock } from "@/components/ThaiClock";
import en from "@/messages/en.json";
import ms from "@/messages/ms.json";
import th from "@/messages/th.json";

describe("Thailand's time in the header (owner, 13 Oct)", () => {
  it("is Bangkok's clock, whatever zone the device is in", () => {
    // 19:05 UTC is 02:05 the next day in Thailand (UTC+7).
    expect(thaiTime(Date.UTC(2026, 9, 12, 19, 5))).toBe("02:05");
    expect(thaiTime(Date.UTC(2026, 9, 13, 7, 0))).toBe("14:00");
  });

  it("shows the number alone, at both sizes; the word is only for a screen reader", () => {
    for (const size of ["wide", "small"] as const) {
      const { container } = render(<ThaiClock size={size} label="Time" />);
      const clock = container.querySelector(`[data-clock='${size}']`)!;
      expect(clock.querySelector(".sr-only")!.textContent).toBe("Time ");
      clock.querySelector(".sr-only")!.remove();
      expect(clock.textContent).toMatch(/^\d\d:\d\d$/);
    }
  });

  it("nowhere in the app says whose time it is: the users are in Thailand", () => {
    const named = /thailand time|bangkok|เวลาไทย|เวลาประเทศไทย|กรุงเทพ|waktu thai/i;
    for (const messages of [th, ms, en]) {
      const found: string[] = [];
      /*
       * "Who built Jaga" is the one page where a city is a fact about a person rather than a
       * label on a clock: two of the founder's jobs were in Bangkok, and saying so is most of
       * what makes a Thai reader trust the page. It carries no clock and no time label, so the
       * blunt city-name scan is lifted there and nowhere else.
       */
      const walk = (node: unknown, path: string) => {
        if (path === ".about") return;
        if (typeof node === "string") {
          if (named.test(node)) found.push(path);
        } else if (node && typeof node === "object") {
          for (const [key, value] of Object.entries(node)) walk(value, `${path}.${key}`);
        }
      };
      walk(messages, "");
      expect(found).toEqual([]);
    }
  });
});
