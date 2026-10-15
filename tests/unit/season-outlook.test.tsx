import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import { SeasonOutlookText } from "@/components/map/SeasonOutlook";
import {
  stillCurrent,
  timesInTen,
  toSeasonOutlook,
  type SeasonOutlook,
} from "@/lib/season-outlook";
import en from "@/messages/en.json";
import ms from "@/messages/ms.json";
import th from "@/messages/th.json";

const THIS_YEAR: SeasonOutlook = {
  season: 2026,
  issued_on: "2026-10-14",
  lean: "none",
  pacific: "el_nino",
  skill_pct: 51.5,
  chance_pct: 31.5,
};
const OCT_15 = Date.UTC(2026, 9, 15);

const show = (
  props: Partial<Parameters<typeof SeasonOutlookText>[0]>,
  messages = en,
  locale = "en",
) =>
  render(
    <NextIntlClientProvider locale={locale} messages={messages} timeZone="Asia/Bangkok">
      <SeasonOutlookText outlook={THIS_YEAR} load="ok" now={OCT_15} {...props} />
    </NextIntlClientProvider>,
  ).container;

describe("the season outlook's public line", () => {
  it("accepts only a well-formed answer", () => {
    expect(toSeasonOutlook({ ...THIS_YEAR })).toEqual(THIS_YEAR);
    expect(toSeasonOutlook(null)).toBeNull();
    expect(toSeasonOutlook({ ...THIS_YEAR, lean: "very wet" })).toBeNull();
    expect(toSeasonOutlook({ ...THIS_YEAR, issued_on: "yesterday" })).toBeNull();
    expect(toSeasonOutlook({ ...THIS_YEAR, pacific: "storm", skill_pct: 140 })).toMatchObject({
      pacific: null,
      skill_pct: null,
    });
  });

  it("speaks for its season until the end of January, Bangkok time, and not after", () => {
    expect(stillCurrent(THIS_YEAR, OCT_15)).toBe(true);
    expect(stillCurrent(THIS_YEAR, Date.UTC(2027, 0, 31, 16, 59))).toBe(true); // 23:59 on 31 Jan in Bangkok
    expect(stillCurrent(THIS_YEAR, Date.UTC(2027, 0, 31, 17, 0))).toBe(false);
    expect([31.5, 38.5, 51.5, 104].map(timesInTen)).toEqual([3, 4, 5, 10]);
  });

  it("says the lean, what points that way, how often it was right, that bursts cannot be foreseen, and who alerts", () => {
    const text = show({}).textContent!;
    expect(text).toContain("No clear lean this season.");
    expect(text).toContain("An El Niño in the Pacific points to less rain than usual.");
    expect(text).toContain("about 5 times in 10");
    expect(text).toContain("cannot be foreseen this far ahead. Prepare as for any year.");
    expect(text).toContain("not taken from this outlook");
    expect(text).toContain("Issued October 14, 2026");
  });

  it("wears no alert colour and no status colour, whatever it leans", () => {
    for (const lean of ["none", "dry", "normal", "wet"] as const) {
      const html = show({ outlook: { ...THIS_YEAR, lean } }).innerHTML;
      expect(html).not.toMatch(/bg-alert|text-alert|bg-sos|border-alert/);
      expect(html).toContain(`data-outlook-lean="${lean}"`);
    }
  });

  it("never reads as 'no flood' when it cannot be had, is out of date, or was never issued", () => {
    expect(show({ load: "unavailable" }).textContent).toBe(
      "The rainy-season outlook can't be loaded right now.",
    );
    expect(show({ outlook: null }).textContent).toBe("There is no outlook for this season yet.");
    expect(show({ now: Date.UTC(2027, 2, 1) }).textContent).toBe(
      "There is no outlook for this season yet.",
    );
    expect(show({ load: "loading" }).textContent).toBe("Loading the outlook…");
  });

  it("has every line in Thai and Malay too", () => {
    for (const [messages, locale] of [
      [th, "th"],
      [ms, "ms"],
    ] as const) {
      const text = show({}, messages as typeof en, locale).textContent!;
      expect(text).not.toMatch(/map\.outlook|\{n\}|\{date\}/);
      expect(text.length).toBeGreaterThan(150);
    }
  });
});
