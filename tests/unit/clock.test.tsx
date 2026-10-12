import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { thaiTime, ThaiClock } from "@/components/ThaiClock";

describe("Thailand's time in the header (owner, 13 Oct)", () => {
  it("is Bangkok's clock, whatever zone the device is in", () => {
    // 19:05 UTC is 02:05 the next day in Thailand (UTC+7).
    expect(thaiTime(Date.UTC(2026, 9, 12, 19, 5))).toBe("02:05");
    expect(thaiTime(Date.UTC(2026, 9, 13, 7, 0))).toBe("14:00");
  });

  it("says which country's time it is: in full on a wide screen, in a few letters on a phone", () => {
    const wide = render(<ThaiClock short="TH" long="Thailand time" />).container;
    expect(wide.querySelector("[data-clock='wide']")!.textContent).toMatch(
      /Thailand time .*\d\d:\d\d$/,
    );
    const small = render(<ThaiClock size="small" short="TH" long="Thailand time" />).container;
    const clock = small.querySelector("[data-clock='small']")!;
    expect(clock.querySelector("[aria-hidden]")!.textContent).toBe("TH ");
    // A screen reader still hears the whole name.
    expect(clock.querySelector(".sr-only")!.textContent).toContain("Thailand time");
  });
});
