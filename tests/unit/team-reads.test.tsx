import { fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HouseholdsView, ReportsView } from "@/components/authority/TeamReads";
import { EXAMPLE_HOUSEHOLDS, EXAMPLE_REPORTS } from "@/lib/authority-examples";
import { cleanCounts, householdsByTambon, vulnerableCounts, vulnerableTotal } from "@/lib/coverage";
import en from "@/messages/en.json";
import ms from "@/messages/ms.json";
import th from "@/messages/th.json";
import { renderWithIntl } from "./render";

const WITH_PHONE = "bbbbbbbb-0000-4000-8000-000000000001";
const NO_PHONE = "bbbbbbbb-0000-4000-8000-000000000002";

describe("household arithmetic", () => {
  it("lists the categories a household counted, in the fixed order, and skips the zeroes", () => {
    expect(vulnerableCounts({ needs_dialysis: 1, elderly: 2, pregnant: 0 })).toEqual([
      { key: "elderly", count: 2 },
      { key: "needs_dialysis", count: 1 },
    ]);
    expect(vulnerableCounts(null)).toEqual([]);
    expect(vulnerableTotal({ elderly: 2, bedridden: 1 })).toBe(3);
  });

  it("groups by tambon, and puts the household with the most vulnerable people first", () => {
    const groups = householdsByTambon(EXAMPLE_HOUSEHOLDS);
    expect(groups.map((g) => g.tambon)).toEqual(["940104", "940111"]);
    expect(groups[0]!.rows.map((h) => vulnerableTotal(h.vulnerable))).toEqual([3, 2]);
  });

  it("takes only whole counts from 0 to 20 for the known categories from a form", () => {
    expect(
      cleanCounts({ elderly: "2", bedridden: "0", pregnant: "", infant_child: "99", hacker: "5" }),
    ).toEqual({ elderly: 2, infant_child: 20 });
    expect(cleanCounts({ elderly: "-3", disability: "abc" })).toEqual({});
  });
});

describe("households, as a team reads them", () => {
  const draw = (phones: Record<string, string | null> = {}) => {
    const onPhone = vi.fn();
    renderWithIntl(
      <HouseholdsView households={EXAMPLE_HOUSEHOLDS} phones={phones} onPhone={onPhone} />,
    );
    return onPhone;
  };
  const card = (id: string) => document.querySelector(`[data-household="${id}"]`)!;

  it("says what the list is for and that every look is recorded, before any household", () => {
    draw();
    const view = document.querySelector('[data-view="households"]')!;
    expect(view.textContent).toContain(th.authority.households.purpose);
    expect(view.textContent).toContain(th.authority.households.logged);
    const first = view.querySelector("[data-household]")!;
    const purpose = view.querySelector("section")!;
    expect(purpose.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("carries no phone number: one is shown after a tap, for one household", () => {
    const onPhone = draw();
    expect(document.querySelectorAll('a[href^="tel:"]').length).toBe(0);
    expect(document.body.textContent).not.toMatch(/\+?66\d{8}|0\d{8,9}/);
    fireEvent.click(card(WITH_PHONE).querySelector("[data-household-phone]")!);
    expect(onPhone).toHaveBeenCalledWith(WITH_PHONE);
  });

  it("offers no number where the household gave none, and says so", () => {
    draw();
    expect(card(NO_PHONE).querySelector("[data-household-phone]")).toBeNull();
    expect(card(NO_PHONE).textContent).toContain(th.authority.households.noPhone);
  });

  it("shows the number once it was asked for, and that the look was logged", () => {
    draw({ [WITH_PHONE]: "+66812223333" });
    const shown = card(WITH_PHONE);
    expect(shown.querySelector('a[href="tel:+66812223333"]')).not.toBeNull();
    expect(shown.textContent).toContain(th.authority.act.phoneLogged);
    expect(card(NO_PHONE).querySelector('a[href^="tel:"]')).toBeNull();
  });

  it("shows who needs help first, the note, and that a relative registered it", () => {
    draw();
    const one = card(WITH_PHONE);
    expect(one.textContent).toContain(`${th.sos.vulnerable.elderly} 2`);
    expect(one.textContent).toContain(`${th.sos.vulnerable.bedridden} 1`);
    expect(one.textContent).toContain("เปลหาม");
    expect(document.body.textContent).toContain(th.authority.households.onBehalf);
  });

  it("says plainly when the team is not allowed to see households", () => {
    renderWithIntl(<HouseholdsView households="failed" phones={{}} onPhone={() => {}} />);
    expect(document.body.textContent).toContain(th.authority.households.failed);
    expect(document.querySelector("[data-household]")).toBeNull();
  });
});

describe("flood reports, as a team reads them", () => {
  it("say what the water is doing and where, and name no reporter", () => {
    const onMedia = vi.fn();
    renderWithIntl(<ReportsView reports={EXAMPLE_REPORTS} media={{}} onMedia={onMedia} />);
    const first = document.querySelector("[data-report]")!;
    expect(first.textContent).toContain(th.report.depths.knee);
    expect(first.textContent).toContain(th.report.trends.rising);
    expect(first.textContent).toContain(th.report.roads.motorbike_only);
    expect(first.querySelector('a[href*="google.com/maps/dir"]')).not.toBeNull();
    // Photos are asked for by a tap; a report without any offers no button.
    fireEvent.click(first.querySelector("[data-report-media]")!);
    expect(onMedia).toHaveBeenCalledWith(EXAMPLE_REPORTS[0]!.id);
    expect(document.querySelectorAll("[data-report-media]").length).toBe(1);
    expect(document.querySelectorAll("[data-report] img").length).toBe(0);
  });

  it("mark a report no admin has checked yet", () => {
    renderWithIntl(<ReportsView reports={EXAMPLE_REPORTS} media={{}} onMedia={() => {}} />);
    const cards = [...document.querySelectorAll("[data-report]")];
    expect(cards[0]!.textContent).not.toContain(th.authority.reports.unchecked);
    expect(cards[1]!.textContent).toContain(th.authority.reports.unchecked);
  });

  it("say so when there are none", () => {
    renderWithIntl(<ReportsView reports={[]} media={{}} onMedia={() => {}} />);
    expect(document.body.textContent).toContain(th.authority.reports.none);
  });
});

describe("the wording", () => {
  const keys = (o: unknown, prefix = ""): string[] =>
    o && typeof o === "object"
      ? Object.entries(o).flatMap(([k, v]) => keys(v, `${prefix}${k}.`))
      : [prefix.slice(0, -1)];

  it("exists in Thai, Malay and English, key for key", () => {
    const groups = [
      (m: typeof th) => m.authority.reports,
      (m: typeof th) => m.authority.households,
      (m: typeof th) => m.authority.views,
      (m: typeof th) => m.household,
    ];
    for (const group of groups) {
      const thai = keys(group(th)).sort();
      expect(keys(group(en as unknown as typeof th)).sort()).toEqual(thai);
      expect(keys(group(ms as unknown as typeof th)).sort()).toEqual(thai);
    }
  });

  it("tells the resident it is not a request for help, and who will see it", () => {
    for (const m of [th, en, ms]) {
      expect(m.household.intro).toMatch(/1784/);
      expect(m.household.who.length).toBeGreaterThan(40);
    }
  });
});
