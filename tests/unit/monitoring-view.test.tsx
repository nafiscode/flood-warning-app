import { describe, expect, it } from "vitest";
import { MonitoringNow } from "@/components/monitoring/MonitoringNow";
import { MapSummary } from "@/components/map/MapSummary";
import type { AlertLevel } from "@/lib/brand/tokens";
import type { LevelTally } from "@/lib/map-console";
import type { Monitoring, Note } from "@/lib/monitoring";
import { exampleAlert, BANA } from "@/lib/dev-examples";
import en from "@/messages/en.json";
import ms from "@/messages/ms.json";
import th from "@/messages/th.json";
import { renderWithIntl } from "./render";

/*
 * Two promises are kept here and nowhere else:
 *   - the monitoring section can never be mistaken for a level: no alert hue, no badge, no pill
 *     and none of the five levels' icons (safety rule 2, docs/brand.md);
 *   - an absence is never drawn as "all is well": a feed that could not be read says so, and a
 *     figure nobody could read is never a nought (safety rule 10).
 */

const AT = "2026-11-20T06:00:00.000Z";

const note = (over: Partial<Note> & Pick<Note, "kind">): Note =>
  ({
    say: "quiet",
    weight: 0,
    scope: "fourProvinces",
    at: AT,
    ageMin: 30,
    over: 0,
    near: 0,
    reporting: 4,
    silent: 0,
    total: 4,
    damCode: "banglang",
    attention: "none",
    percentFull: 60,
    outflowCms: 20,
    spilledCms: null,
    pastNormal: false,
    stale: false,
    onMyRiver: false,
    reports: 0,
    people: 0,
    tambons: 0,
    confirmed: 0,
    here: 0,
    group: "clear",
    rainMm: 0,
    wet: false,
    ...over,
  }) as unknown as Note;

const summary = (notes: Note[]): Monitoring => ({
  notes,
  anyUnknown: notes.some((n) => n.say === "unknown"),
  allUnknown: notes.length > 0 && notes.every((n) => n.say === "unknown"),
  newestAt: notes.reduce<string | null>((best, n) => (n.at && (!best || n.at > best) ? n.at : best), null),
});

function section(notes: Note[], locale: "th" | "en" = "th") {
  return renderWithIntl(
    <MonitoringNow
      summary={summary(notes)}
      scopeWords={{ province: "ปัตตานี", myPlace: "บานา" }}
      damName="เขื่อนบางลาง"
      damTambon="บานา"
      rainPlace="บานา"
      time={() => "13:00"}
      place="home"
    />,
    locale,
  ).container;
}

const ALL_KINDS: Note["kind"][] = ["gauges", "dam", "reports", "rain"];

describe("the monitoring section can never look like a level", () => {
  const every = ALL_KINDS.map((kind) => note({ kind }));

  for (const say of ["active", "quiet", "unknown"] as const) {
    it(`wears no alert colour, badge or pill when everything says "${say}"`, () => {
      const c = section(ALL_KINDS.map((kind) => note({ kind, say, weight: say === "active" ? 2 : 0 })));
      expect(c.querySelector("[data-monitoring]")).not.toBeNull();
      expect(c.innerHTML).not.toMatch(/alert-(normal|watch|warning|evacuate|return|stale)/);
      expect(c.querySelector("[data-level]")).toBeNull();
      expect(c.querySelector("[data-dam-chip]")).toBeNull();
      expect(c.querySelector("[data-console-level]")).toBeNull();
    });
  }

  it("draws every feed it was given, including the ones that could not be read", () => {
    const c = section(every);
    for (const kind of ALL_KINDS) {
      expect(c.querySelector(`[data-monitoring-note="${kind}"]`)).not.toBeNull();
    }
  });

  it("says who is speaking on every line", () => {
    const c = section(every);
    for (const kind of ALL_KINDS) {
      const line = c.querySelector(`[data-monitoring-note="${kind}"]`)!;
      expect(line.textContent).toContain(th.monitoring[kind].who);
    }
  });

  it("credits Open-Meteo whenever a line of it comes from the weather model", () => {
    expect(section([note({ kind: "rain" })]).innerHTML).toContain("open-meteo.com");
    // And not when no line does: a credit for data that is not shown is noise.
    expect(section([note({ kind: "gauges" })]).innerHTML).not.toContain("open-meteo.com");
  });
});

describe("the monitoring section never reads as an all-clear", () => {
  it("says only that nothing could be read when nothing could, and draws no quiet line", () => {
    const c = section(ALL_KINDS.map((kind) => note({ kind, say: "unknown" })));
    expect(c.querySelector('[data-monitoring-say="allUnknown"]')?.textContent).toBe(
      th.monitoring.allUnknown,
    );
    expect(c.querySelector('[data-monitoring-say="quiet"]')).toBeNull();
    expect(c.querySelector("[data-monitoring-note]")).toBeNull();
  });

  it("warns that the list is incomplete when only some of it could be read", () => {
    const c = section([note({ kind: "gauges" }), note({ kind: "dam", say: "unknown" })]);
    expect(c.querySelector("[data-monitoring-incomplete]")).not.toBeNull();
    expect(c.querySelector('[data-monitoring-say="allUnknown"]')).toBeNull();
  });

  it("says the rivers are not being measured, not that they are low, when all are silent", () => {
    const c = section([
      note({ kind: "gauges", say: "unknown", reporting: 0, silent: 4, total: 4 }),
      note({ kind: "dam" }),
    ]);
    const line = c.querySelector('[data-monitoring-note="gauges"]')!;
    expect(line.textContent).toContain("ไม่มีสถานีใดส่งข้อมูล");
    expect(line.textContent).not.toContain("ต่ำกว่าระดับตลิ่ง");
  });

  it("keeps a late reading's figures and adds that it is late, never hiding it", () => {
    const c = section([note({ kind: "dam", say: "active", weight: 2, attention: "releasing", outflowCms: 300, stale: true })]);
    const line = c.querySelector('[data-monitoring-note="dam"]')!;
    expect(line.textContent).toContain("300");
    expect(line.textContent).toContain(th.monitoring.dam.stale);
  });

  it("says nothing at all when it was given no feeds, rather than that all is quiet", () => {
    expect(section([]).querySelector("[data-monitoring]")).toBeNull();
  });
});

describe("the words of the monitoring section", () => {
  it("says the same things in all three languages", () => {
    const keys = (o: object, p = ""): string[] =>
      Object.entries(o).flatMap(([k, v]) =>
        typeof v === "object" && v !== null ? keys(v, `${p}${k}.`) : [`${p}${k}`],
      );
    const thKeys = keys(th.monitoring).sort();
    expect(keys(en.monitoring).sort()).toEqual(thKeys);
    expect(keys(ms.monitoring).sort()).toEqual(thKeys);
    expect(keys(en.map.summary).sort()).toEqual(keys(th.map.summary).sort());
    expect(keys(ms.map.summary).sort()).toEqual(keys(th.map.summary).sort());
  });

  /*
   * The lines that say who is speaking, and the ones that say an absence is not safety, are the
   * whole reason this section is allowed on a home screen. A short one has lost its argument.
   */
  it("never shortens the lines that name the speaker or refuse an all-clear", () => {
    for (const [lang, m] of [["th", th], ["en", en], ["ms", ms]] as const) {
      expect(m.monitoring.caption.length, lang).toBeGreaterThan(80);
      expect(m.monitoring.allUnknown.length, lang).toBeGreaterThan(60);
      expect(m.monitoring.reports.quiet.length, lang).toBeGreaterThan(60);
      expect(m.map.summary.noneInForce.length, lang).toBeGreaterThan(50);
      for (const kind of ALL_KINDS) expect(m.monitoring[kind].who.length, lang).toBeGreaterThan(10);
    }
  });

  it("never claims anything is fine, safe or clear", () => {
    const banned = /\ball[- ]clear\b|\bno risk\b|\bis safe\b|\beverything is fine\b/i;
    for (const m of [en, ms]) {
      for (const text of Object.values(m.monitoring).flatMap((v) =>
        typeof v === "string" ? [v] : Object.values(v),
      )) {
        expect(text).not.toMatch(banned);
      }
    }
  });
});

describe("where things stand, above the map", () => {
  const tally = (level: AlertLevel, tambons: number): LevelTally => ({ level, tambons });
  const alert = (level: "watch" | "warning") => exampleAlert(level, [BANA.code]);

  function summaryCard(over: Partial<Parameters<typeof MapSummary>[0]> = {}) {
    return renderWithIntl(
      <MapSummary
        hero={{ kind: "alert", alert: alert("warning") }}
        myTambonCode={BANA.code}
        myTambonName="บานา"
        levels={[tally("evacuate", 0), tally("warning", 2), tally("watch", 1)]}
        statusKnown
        inService
        gaugesOver={3}
        reportsTotal={7}
        provinceWord="ปัตตานี"
        allWord="ทั้งสี่จังหวัด"
        now={Date.parse("2026-11-20T07:00:00.000Z")}
        {...over}
      />,
    ).container;
  }

  it("leads with the person's own subdistrict, carrying everything a level must say", () => {
    const c = summaryCard();
    const area = c.querySelector('[data-map-summary-part="area"]')!;
    expect(area.querySelector('[data-hero="alert"]')).not.toBeNull();
    expect(area.querySelector('[data-level="warning"]')).not.toBeNull();
    expect(area.textContent).toContain("บานา");
    // Issuer, issue time and next update come with AlertHero (safety rule 3).
    expect(area.textContent).toContain(th.home.issuedBy);
    expect(area.textContent).toContain(th.home.nextUpdate);
  });

  it("puts the person's own subdistrict before the province around it", () => {
    const c = summaryCard();
    const area = c.querySelector('[data-map-summary-part="area"]')!;
    const province = c.querySelector('[data-map-summary-part="province"]')!;
    expect(area.compareDocumentPosition(province) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows no level at all, and no colour, when nobody has said where they are", () => {
    const c = summaryCard({ hero: null, myTambonCode: null, myTambonName: null });
    expect(c.querySelector("[data-map-summary-noarea]")?.textContent).toBe(th.map.summary.noArea);
    expect(c.querySelector('[data-map-summary-part="area"] [data-level]')).toBeNull();
    expect(c.querySelector('[data-map-summary-part="area"]')!.innerHTML).not.toMatch(/alert-/);
  });

  /* A status nobody could read is not a status of "none" (safety rule 10). */
  it("says the status could not be read, and draws no counts, when it could not", () => {
    const c = summaryCard({ statusKnown: false });
    expect(c.querySelector('[data-map-summary-status="unknown"]')).not.toBeNull();
    expect(c.querySelector('[data-map-summary-status="none"]')).toBeNull();
    expect(c.querySelector("[data-console-level]")).toBeNull();
  });

  it("explains that no alert in force is not the same as no risk", () => {
    const c = summaryCard({ levels: [tally("warning", 0)] });
    const none = c.querySelector('[data-map-summary-status="none"]')!;
    expect(none.textContent).toContain(th.map.summary.noneInForce.slice(0, 30));
  });

  it("says Jaga is not in service yet rather than that no alert is in force", () => {
    const c = summaryCard({ inService: false, levels: [tally("warning", 0)] });
    expect(c.querySelector('[data-map-summary-status="notInService"]')).not.toBeNull();
    expect(c.querySelector('[data-map-summary-status="none"]')).toBeNull();
  });

  it("writes a figure it could not read as such, never as nought", () => {
    const c = summaryCard({ gaugesOver: null, reportsTotal: null });
    const figures = [...c.querySelectorAll("[data-summary-figure]")];
    expect(figures).toHaveLength(2);
    for (const figure of figures) {
      expect(figure.getAttribute("data-summary-unknown")).toBe("true");
      expect(figure.textContent).toContain(th.map.summary.unknownFigure);
      expect(figure.textContent).not.toMatch(/\b0\b/);
    }
  });
});
