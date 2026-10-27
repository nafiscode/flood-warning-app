/**
 * The reservoirs' panel on the signals dashboard (the owner, 27 Oct 2026: "threshold can adjust
 * later, and can click enable if I want automatic alarm or not").
 *
 * What is checked here is what an admin can see and do: the live figure, the two shares in boxes
 * they can type into, the switch, and — the part that matters most — that a reservoir which is
 * armed but cannot actually fire says so instead of looking ready.
 */
import IntlMessageFormat from "intl-messageformat";
import { describe, expect, it } from "vitest";
import { ReservoirLevels } from "@/components/admin/ReservoirLevels";
import type { DamSignal } from "@/lib/dam";
import { damRuleGap, shareAsMcm, toDamLevels, toDamLevelsList } from "@/lib/dam-levels";
import type { DamLevels } from "@/lib/dam-levels";
import en from "@/messages/en.json";
import ms from "@/messages/ms.json";
import th from "@/messages/th.json";
import { renderWithIntl } from "./render";

const signal = (over: Partial<DamSignal> = {}): DamSignal => ({
  observedAt: "2026-10-26T22:00:00.000Z",
  fetchedAt: "2026-10-26T22:05:00.000Z",
  storageMcm: 3.35,
  percentFull: 55.8,
  levelM: null,
  inflowCms: 0.6,
  releasedCms: null,
  spilledCms: null,
  outflowCms: 0,
  riseMcmPerH: 0.015,
  riseWindowH: 1,
  grade: "watchful",
  reasons: ["rising_fast"],
  awaiting: [],
  readings: 13,
  stale: false,
  confirmedOver: 1,
  ...over,
});

const dam = (over: Partial<DamLevels> = {}): DamLevels => ({
  code: "khlong_chamrai",
  name: { th: "อ่างเก็บน้ำคลองจำไหร", en: "Khlong Chamrai Reservoir" },
  operator: "RID",
  feed: "daily",
  storageMaxMcm: 6,
  storageNormalMcm: 6,
  nearFullPct: 80,
  fullPct: 95,
  auto: true,
  autoSetAt: "2026-10-26T23:00:00.000Z",
  autoSetBy: null,
  tambons: 1,
  signal: signal(),
  ...over,
});

/*
 * The English copy, formatted as next-intl would format it, so the assertions read as the admin
 * would read them - and so an ICU plural is exercised rather than printed raw. (It was printed
 * raw by the first version of this helper, which is how "1 tambons" would have reached a screen.)
 */
const t = ((key: string, values?: Record<string, string | number>) => {
  const walk = (o: unknown, path: string[]): unknown =>
    path.length === 0 ? o : walk((o as Record<string, unknown>)[path[0]!], path.slice(1));
  const text = walk(en.signals, key.split(".")) as string;
  if (typeof text !== "string") return key;
  return String(new IntlMessageFormat(text, "en").format(values ?? {}));
}) as Parameters<typeof ReservoirLevels>[0]["t"];

describe("reading admin_dam_levels()", () => {
  it("takes a row as the database gives it", () => {
    const got = toDamLevels({
      code: "ban_baik",
      name: { th: "อ่างเก็บน้ำบ้านไบก์", en: "Ban Baik Reservoir" },
      operator: "RID",
      feed: "daily",
      storageMaxMcm: 1.2,
      storageNormalMcm: 1.2,
      nearFullPct: 80,
      fullPct: 95,
      auto: true,
      autoSetAt: "2026-10-26T23:00:00.000Z",
      autoSetBy: "Nafis",
      tambons: 3,
      signal: { observed_at: "x", fetched_at: "y", percent_full: 12.5, grade: "quiet" },
    });
    expect(got?.code).toBe("ban_baik");
    expect(got?.fullPct).toBe(95);
    expect(got?.auto).toBe(true);
    expect(got?.signal?.percentFull).toBe(12.5);
    // A row with no name is not a reservoir the screen can draw.
    expect(toDamLevels({ code: "x" })).toBeNull();
    expect(toDamLevelsList(null)).toEqual([]);
    expect(toDamLevelsList([{ code: "x" }, null, 7])).toEqual([]);
  });

  it("says a share in million cubic metres, which is what an operator reads", () => {
    expect(shareAsMcm(dam(), 95)).toBe(5.7);
    expect(shareAsMcm(dam(), null)).toBeNull();
    expect(shareAsMcm(dam({ storageMaxMcm: null }), 95)).toBeNull();
  });

  it("names why a rule could not fire, and nothing when it can", () => {
    expect(damRuleGap(dam())).toBeNull();
    expect(damRuleGap(dam({ nearFullPct: null, fullPct: null }))).toBe("noThreshold");
    expect(damRuleGap(dam({ tambons: 0 }))).toBe("noZone");
    expect(damRuleGap(dam({ signal: null }))).toBe("noReading");
    // One threshold is enough for the rules to mean something.
    expect(damRuleGap(dam({ nearFullPct: null }))).toBeNull();
  });
});

describe("the reservoirs' panel", () => {
  it("shows what the reservoir is doing and the two shares in boxes", () => {
    const { container } = renderWithIntl(
      <ReservoirLevels dams={[dam()]} t={t} locale="en" levelsAction={() => {}} autoAction={() => {}} />,
    );
    const card = container.querySelector('[data-reservoir="khlong_chamrai"]')!;
    expect(card).not.toBeNull();
    expect(card.textContent).toContain("Khlong Chamrai Reservoir");
    expect(card.querySelector("[data-reservoir-now]")!.textContent).toContain("55.8");
    // Its own grade is said in words, never by colour alone - and in this panel's own words,
    // because the `dam` namespace the public chip reads never reaches the browser here.
    expect(card.querySelector("[data-reservoir-state]")!.getAttribute("data-reservoir-state")).toBe(
      "watch",
    );
    expect(card.textContent).toContain("Worth watching");
    expect(card.textContent).not.toContain("dam.state");
    expect(card.textContent).toContain("Reservoir storage is rising sharply");
    // One tambon is a tambon, not "1 tambons".
    expect(card.textContent).toContain("1 tambon");
    expect(card.textContent).not.toContain("1 tambons");
    // The two boxes, prefilled with what is stored, and the share in Mm3 beside each.
    const near = card.querySelector<HTMLInputElement>('input[data-level="nearFull"]')!;
    const full = card.querySelector<HTMLInputElement>('input[data-level="full"]')!;
    expect(near.defaultValue).toBe("80");
    expect(full.defaultValue).toBe("95");
    expect(card.textContent).toContain("5.7");
    // And the switch, ticked, with what it allows said beside it.
    const tick = card.querySelector<HTMLInputElement>('input[name="enabled"]')!;
    expect(tick.defaultChecked).toBe(true);
    expect(card.textContent).toContain("Warning only");
  });

  it("says a threshold is off rather than showing an empty box with no explanation", () => {
    const { container } = renderWithIntl(
      <ReservoirLevels dams={[dam({ nearFullPct: null })]} t={t} locale="en" />,
    );
    const card = container.querySelector('[data-reservoir="khlong_chamrai"]')!;
    expect(card.querySelector<HTMLInputElement>('input[data-level="nearFull"]')!.defaultValue).toBe("");
    expect(card.textContent).toContain("this threshold is off");
  });

  /*
   * The one that matters: armed and unable to fire. A tick that looks on while nothing could
   * come of it is the sort of thing somebody relies on in a flood.
   */
  it("warns when a reservoir is armed but could not raise anything", () => {
    for (const [over, gap] of [
      [{ nearFullPct: null, fullPct: null }, "noThreshold"],
      [{ tambons: 0 }, "noZone"],
      [{ signal: null }, "noReading"],
    ] as const) {
      const { container } = renderWithIntl(
        <ReservoirLevels dams={[dam(over)]} t={t} locale="en" autoAction={() => {}} />,
      );
      expect(container.querySelector(`[data-reservoir-gap="${gap}"]`)).not.toBeNull();
    }
  });

  it("counts how many reservoirs are armed, and draws nothing when there are none", () => {
    const { container } = renderWithIntl(
      <ReservoirLevels
        dams={[dam(), dam({ code: "ban_baik", auto: false })]}
        t={t}
        locale="en"
      />,
    );
    expect(container.querySelector("[data-reservoirs]")!.getAttribute("data-reservoirs")).toBe("2");
    expect(container.textContent).toContain("armed for 1 of 2");
    const empty = renderWithIntl(<ReservoirLevels dams={[]} t={t} locale="en" />);
    expect(empty.container.querySelector("[data-reservoirs]")).toBeNull();
  });

  it("without the actions it is a read-only panel: no save buttons", () => {
    const { container } = renderWithIntl(<ReservoirLevels dams={[dam()]} t={t} locale="en" />);
    expect(container.querySelectorAll("button[type=submit]")).toHaveLength(0);
    // The figures are still there: an admin with no permission still sees the state.
    expect(container.querySelector("[data-reservoir-now]")).not.toBeNull();
  });

  it("every key the panel asks for exists in all three languages", () => {
    const used = [
      "title", "intro", "armedCount", "operator", "capacity", "feed.hourly", "feed.daily",
      "now", "noFigure", "noReading", "observed", "stale", "thresholds", "nearFull", "full",
      "asMcm", "off", "thresholdsHint", "save", "saved", "error", "auto", "autoHint",
      "autoSince", "autoBySeed", "saveAuto", "autoSaved", "autoError", "zone",
      "gap.noThreshold", "gap.noZone", "gap.noReading",
      "state.unknown", "state.normal", "state.watch", "state.releasing",
      "reason.near_full", "reason.full_and_rising", "reason.rising_fast", "reason.spilling",
    ];
    const files = { th, ms, en };
    for (const [locale, messages] of Object.entries(files)) {
      for (const key of used) {
        const text = key
          .split(".")
          .reduce<unknown>((at, part) => (at as Record<string, unknown>)?.[part], messages.signals.reservoirs);
        expect(typeof text === "string" && text.length > 0, `${locale} ${key}`).toBe(true);
      }
      // The operator's name has to resolve in this namespace too, not the dam card's.
      expect(typeof messages.signals.operators.rid).toBe("string");
    }
  });
});
