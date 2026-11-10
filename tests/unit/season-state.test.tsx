import { render as plainRender } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { SignalsView } from "@/components/admin/Signals";
import {
  monthsFor,
  type SeasonState,
  openNoticeFor,
  seasonNote,
  toSeasonNotices,
  toSeasonReferences,
  toSeasonStates,
} from "@/lib/season-state";
import {
  EXAMPLE_GAUGE_LEVELS,
  EXAMPLE_SEASON_NOTICES,
  EXAMPLE_SEASON_SIGNALS,
  EXAMPLE_SEASON_STATE,
  EXAMPLE_SIGNALS,
} from "@/lib/signals-examples";
import { withGaugeLevels } from "@/lib/signals";
import en from "@/messages/en.json";
import ms from "@/messages/ms.json";
import th from "@/messages/th.json";

vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh: () => {} }),
}));

const render = (ui: ReactElement) =>
  plainRender(
    <NextIntlClientProvider locale="en" messages={{}}>
      {ui}
    </NextIntlClientProvider>,
  );

function translator(messages: Record<string, unknown>) {
  return (key: string, values: Record<string, string | number> = {}) => {
    const text = key
      .split(".")
      .reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], messages);
    if (typeof text !== "string") throw new Error(`missing message signals.${key}`);
    return text.replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? `{${name}}`));
  };
}

const states = toSeasonStates(EXAMPLE_SEASON_SIGNALS);
const references = toSeasonReferences(EXAMPLE_SEASON_STATE);
const notices = toSeasonNotices(EXAMPLE_SEASON_NOTICES);
const PATTANI = "00000000-0000-4000-8000-000000000001";
const KOLOK = "00000000-0000-4000-8000-000000000002";

const view = (
  locale: "en" | "th" | "ms" = "en",
  seasons: Record<string, SeasonState> = states,
) =>
  render(
    <SignalsView
      data={withGaugeLevels(EXAMPLE_SIGNALS, EXAMPLE_GAUGE_LEVELS)}
      seasons={seasons}
      seasonReferences={references}
      seasonNotices={notices}
      locale={locale}
      t={translator({ en, th, ms }[locale].signals as Record<string, unknown>)}
    />,
  );

describe("reading the answers", () => {
  it("keeps the zones it can read and drops the ones it cannot", () => {
    const read = toSeasonStates({
      zones: [
        ...EXAMPLE_SEASON_SIGNALS.zones,
        { basin: "no_id", grade: "rising_wet" },
        { zoneId: "x", grade: "rising_wet" },
        "nonsense",
      ],
    });
    expect(Object.keys(read)).toHaveLength(3);
    expect(read[PATTANI]!.grade).toBe("rising_wet");
    expect(read[KOLOK]!.grade).toBe("wet");
  });

  it("gives nothing at all when the migration is not applied", () => {
    expect(toSeasonStates(null)).toEqual({});
    expect(toSeasonReferences(null)).toEqual([]);
    expect(toSeasonNotices(null)).toEqual([]);
    expect(toSeasonNotices("nonsense")).toEqual([]);
  });

  it("an unknown grade or band reads as the cautious one, never as wrong data", () => {
    const read = toSeasonStates({
      zones: [{ zoneId: PATTANI, basin: "x", grade: "exploding", figures: { floor: { band: "?" } } }],
    });
    expect(read[PATTANI]!.grade).toBe("quiet");
    expect(read[PATTANI]!.figures!.floor.band).toBe("unknown");
  });

  it("puts the months in flood-season order, not in number order", () => {
    expect(monthsFor(references, "gauge", "X.40A").map((m) => m.month)).toEqual([10, 11, 12, 1]);
    expect(monthsFor(references, "zone", "pattani_river").map((m) => m.month)).toEqual([
      10, 11, 12, 1,
    ]);
    expect(monthsFor(references, "gauge", "X.999")).toEqual([]);
  });

  it("finds the episode an admin still has to look at, and only an open one", () => {
    expect(openNoticeFor(notices, PATTANI)?.status).toBe("open");
    expect(openNoticeFor(notices, KOLOK)).toBeNull();
    const closed = toSeasonNotices([{ ...EXAMPLE_SEASON_NOTICES[0]!, status: "dismissed" }]);
    expect(openNoticeFor(closed, PATTANI)).toBeNull();
  });
});

describe("the note that goes on a Watch draft", () => {
  it("is figures and codes only, so it reads the same in every language", () => {
    const note = seasonNote(states[PATTANI]!);
    expect(note).toContain("X.40A 13.62 m");
    expect(note).toContain("floor up 6 of 7 days (+0.41 m)");
    expect(note).toContain("rain 15 d 268 mm (top third)");
    expect(note).toContain("since 1 Oct 611 mm");
    // Never the grade itself: the admin writes what they mean.
    expect(note).not.toContain("rising_wet");
    expect(note.length).toBeLessThanOrEqual(400);
  });

  it("is empty rather than misleading when there are no figures", () => {
    expect(seasonNote({ ...states[PATTANI]!, figures: null })).toBe("");
  });
});

describe("the block on the dashboard", () => {
  it("says which state each zone is in, in words", () => {
    const { container } = view();
    const blocks = [...container.querySelectorAll("[data-signal-season]")];
    expect(blocks.map((b) => b.getAttribute("data-signal-season"))).toEqual([
      "rising_wet",
      "wet",
    ]);
    expect(blocks[0]!.querySelector("[data-season-grade]")!.textContent).toBe(
      en.signals.season.grade.rising_wet,
    );
    // The milder state is shown too, never left blank (safety rule 10).
    expect(blocks[1]!.querySelector("[data-season-grade]")!.textContent).toBe(
      en.signals.season.grade.wet,
    );
  });

  it("never uses the alert palette: it is not a level", () => {
    const { container } = view();
    for (const block of container.querySelectorAll("[data-signal-season]")) {
      expect(block.innerHTML).not.toMatch(/jaga-(watch|warning|evacuate|return)/);
      expect(block.querySelector("[data-alert-badge]")).toBeNull();
    }
  });

  it("prints the floor, the fortnight's rain and the season's total with their thirds", () => {
    const { container } = view();
    const first = container.querySelector("[data-signal-season]")!;
    expect(first.querySelector('[data-season="floor"]')!.textContent).toContain("X.40A");
    expect(first.querySelector('[data-season="floor"]')!.textContent).toContain("6 of the last 7");
    expect(first.querySelector('[data-season="rain15"]')!.textContent).toContain("268");
    expect(first.querySelector('[data-season="rain15"]')!.textContent).toContain(
      en.signals.season.band.high,
    );
    expect(first.querySelector('[data-season="season"]')!.textContent).toContain("611");
  });

  it("shows how far the floor is from normal, and says not to rely on it", () => {
    const { container } = view();
    const line = container.querySelector('[data-season="normal"]')!.textContent ?? "";
    expect(line).toContain("+0.62 m");
    expect(line).toContain("7 seasons");
    // The November 2025 lesson is in the copy itself, where an admin will read it.
    expect(line).toContain("bottom third");
  });

  it("says why it cannot judge instead of looking calm", () => {
    // The third example zone is the one with a gap in its readings; put it on a zone the example
    // signals actually hold, so the block draws.
    const gap = Object.values(states).find((z) => z.basin === "u_taphao")!;
    const { container } = view("en", {
      ...states,
      [KOLOK]: { ...gap, zoneId: KOLOK },
    });
    const blocks = [...container.querySelectorAll("[data-signal-season]")];
    const quiet = blocks[1]!;
    expect(quiet.getAttribute("data-signal-season")).toBe("quiet");
    expect(quiet.querySelector("[data-season-blind]")!.textContent).toContain(
      en.signals.season.why.gaugeDays,
    );
    expect(quiet.querySelector("[data-season-stale]")).not.toBeNull();
    // A zone that can be judged says nothing of the sort.
    expect(blocks[0]!.querySelector("[data-season-blind]")).toBeNull();
  });

  it("warns in the copy that this is not early warning", () => {
    const { container } = view();
    const first = container.querySelector("[data-signal-season]")!;
    expect(first.textContent).toContain(en.signals.season.caveat);
  });

  it("offers the episode and a Watch draft, and says nothing has been sent", () => {
    const { container } = view();
    const notice = container.querySelector("[data-season-notice]")!;
    expect(notice.textContent).toContain(en.signals.season.notice.yours);
    const draft = notice.querySelector("[data-season-draft]")!;
    expect(draft.getAttribute("href")).toContain("/admin/alerts/new");
    expect(draft.getAttribute("href")).toContain("level=watch");
    expect(draft.getAttribute("href")).toContain(`zone=${PATTANI}`);
    // Only the zone that was flagged gets one.
    expect(container.querySelectorAll("[data-season-notice]")).toHaveLength(1);
  });

  it("shows the month-by-month record the owner asked for", () => {
    const { container } = view();
    const months = container.querySelector("[data-season-months]")!;
    expect(months.querySelectorAll("[data-season-month]")).toHaveLength(4);
    expect(months.querySelectorAll("[data-season-rain-month]")).toHaveLength(4);
    expect(months.textContent).toContain("12.59 m / 12.75 m / 13.07 m");
  });

  it("draws nothing at all before the migrations are applied", () => {
    const { container } = render(
      <SignalsView
        data={withGaugeLevels(EXAMPLE_SIGNALS, EXAMPLE_GAUGE_LEVELS)}
        locale="en"
        t={translator(en.signals as Record<string, unknown>)}
      />,
    );
    expect(container.querySelectorAll("[data-signal-season]")).toHaveLength(0);
  });

  it("has the copy in all three languages", () => {
    for (const locale of ["th", "ms", "en"] as const) {
      const { container } = view(locale);
      expect(container.querySelectorAll("[data-signal-season]")).toHaveLength(2);
    }
  });
});
