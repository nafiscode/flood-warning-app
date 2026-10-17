import { fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MonitoringNow } from "@/components/monitoring/MonitoringNow";
import { MonitoringCard } from "@/components/monitoring/MonitoringCard";
import { MonitoringDetail } from "@/components/monitoring/MonitoringDetail";
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
  newestAt: notes.reduce<string | null>(
    (best, n) => (n.at && (!best || n.at > best) ? n.at : best),
    null,
  ),
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
      const c = section(
        ALL_KINDS.map((kind) => note({ kind, say, weight: say === "active" ? 2 : 0 })),
      );
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
    const c = section([
      note({
        kind: "dam",
        say: "active",
        weight: 2,
        attention: "releasing",
        outflowCms: 300,
        stale: true,
      }),
    ]);
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
    // map.summary is gone: its wording moved under monitoring.detail (17 Oct).
    expect("summary" in th.map).toBe(false);
  });

  /*
   * The lines that say who is speaking, and the ones that say an absence is not safety, are the
   * whole reason this section is allowed on a home screen. A short one has lost its argument.
   */
  it("never shortens the lines that name the speaker or refuse an all-clear", () => {
    for (const [lang, m] of [
      ["th", th],
      ["en", en],
      ["ms", ms],
    ] as const) {
      expect(m.monitoring.caption.length, lang).toBeGreaterThan(80);
      expect(m.monitoring.allUnknown.length, lang).toBeGreaterThan(60);
      expect(m.monitoring.reports.quiet.length, lang).toBeGreaterThan(60);
      expect(m.monitoring.detail.noneInForce.length, lang).toBeGreaterThan(50);
      for (const kind of ALL_KINDS) expect(m.monitoring[kind].who.length, lang).toBeGreaterThan(10);
    }
  });

  it("never claims anything is fine, safe or clear", () => {
    const banned = /all[- ]clear|no risk|is safe|everything is fine/i;
    /*
     * The same words are allowed, and wanted, inside a denial: "that is not the same as no risk"
     * is the sentence that stops a quiet reading being taken for safety. So a line that carries
     * one of these phrases has to be denying it.
     */
    const denies = /not|never|bukan|tidak/i;
    const walk = (node: unknown): string[] =>
      typeof node === "string" ? [node] : Object.values(node as object).flatMap(walk);
    for (const m of [en, ms]) {
      for (const text of walk(m.monitoring)) {
        if (banned.test(text)) expect(text, text).toMatch(denies);
      }
    }
  });
});

describe("the card that is the way in", () => {
  const every = ALL_KINDS.map((kind) => note({ kind }));

  function cardOf(notes: Note[], open = false) {
    return renderWithIntl(
      <MonitoringCard
        summary={summary(notes)}
        time={() => "13:00"}
        open={open}
        onToggle={() => {}}
        detail={<p data-detail-here="true">detail</p>}
        place="home"
      />,
    ).container;
  }

  it("says the readings are in their normal range, never that the situation is", () => {
    const c = cardOf(every);
    const said = c.querySelector("[data-monitoring-status]")!;
    expect(said.getAttribute("data-monitoring-status")).toBe("inRange");
    expect(said.textContent).toBe(th.monitoring.status.inRange);
    // The owner's choice of 17 Oct: it speaks about instruments, not about safety.
    expect(said.textContent).not.toContain("สถานการณ์");
  });

  it("leads with what is happening when something is", () => {
    const c = cardOf([
      note({ kind: "gauges", say: "active", weight: 2, over: 2 }),
      note({ kind: "dam" }),
    ]);
    const said = c.querySelector("[data-monitoring-status]")!;
    expect(said.getAttribute("data-monitoring-status")).toBe("watching");
    expect(said.textContent).toContain("2");
  });

  it("says plainly when it could read nothing, and when it could read only some", () => {
    const none = cardOf(ALL_KINDS.map((kind) => note({ kind, say: "unknown" })));
    expect(
      none.querySelector("[data-monitoring-status]")!.getAttribute("data-monitoring-status"),
    ).toBe("unknown");
    const some = cardOf([note({ kind: "gauges" }), note({ kind: "dam", say: "unknown" })]);
    expect(
      some.querySelector("[data-monitoring-status]")!.getAttribute("data-monitoring-status"),
    ).toBe("incomplete");
  });

  /* The mark moves the same way in every state, so it can never read as a green light. */
  it("wears one moving mark in every state, and never an alert colour or a level icon", () => {
    for (const say of ["active", "quiet", "unknown"] as const) {
      const c = cardOf(
        ALL_KINDS.map((kind) => note({ kind, say, weight: say === "active" ? 2 : 0 })),
      );
      expect(c.querySelector("[data-monitoring-pulse]")).not.toBeNull();
      expect(c.innerHTML).not.toMatch(/alert-(normal|watch|warning|evacuate|return|stale)/);
      expect(c.querySelector("[data-level]")).toBeNull();
    }
  });

  it("says it is not an alert whether it is open or shut", () => {
    expect(cardOf(every).textContent).toContain(th.monitoring.notAnAlert);
    expect(cardOf(every, true).textContent).toContain(th.monitoring.notAnAlert);
  });

  it("keeps the detail shut until it is asked for", () => {
    expect(cardOf(every).querySelector("[data-detail-here]")).toBeNull();
    expect(cardOf(every, true).querySelector("[data-detail-here]")).not.toBeNull();
    expect(
      cardOf(every).querySelector("[data-monitoring-open]")!.getAttribute("aria-expanded"),
    ).toBe("false");
  });

  it("draws nothing at all when it was given no feeds", () => {
    expect(cardOf([]).querySelector("[data-monitoring-card]")).toBeNull();
  });
});

describe("what the opened detail holds", () => {
  const tally = (level: AlertLevel, tambons: number): LevelTally => ({ level, tambons });
  const alert = (level: "watch" | "warning") => exampleAlert(level, [BANA.code]);

  function detailOf(over: Partial<Parameters<typeof MonitoringDetail>[0]> = {}) {
    return renderWithIntl(
      <MonitoringDetail
        summary={summary(ALL_KINDS.map((kind) => note({ kind })))}
        scopeWords={{ province: "ปัตตานี", myPlace: "บานา" }}
        damName="เขื่อนบางลาง"
        damTambon="บานา"
        rainPlace="บานา"
        time={() => "13:00"}
        place="map"
        now={Date.parse("2026-11-20T07:00:00.000Z")}
        gaugeScope="ใกล้พื้นที่ของคุณ"
        area={{ hero: { kind: "alert", alert: alert("warning") }, code: BANA.code, name: "บานา" }}
        province={{
          levels: [tally("evacuate", 0), tally("warning", 2), tally("watch", 1)],
          statusKnown: true,
          inService: true,
          scope: "ปัตตานี",
        }}
        {...over}
      />,
    ).container;
  }

  it("leads with the person's own level, carrying everything a level must say", () => {
    const c = detailOf();
    const area = c.querySelector('[data-monitoring-part="area"]')!;
    expect(area.querySelector('[data-level="warning"]')).not.toBeNull();
    expect(area.textContent).toContain("บานา");
    expect(area.textContent).toContain(th.home.issuedBy);
    expect(area.textContent).toContain(th.home.nextUpdate);
  });

  it("puts the person's own level before the province and the measurements", () => {
    const c = detailOf();
    const order = [...c.querySelectorAll("[data-monitoring-part], [data-monitoring]")].map(
      (e) => e.getAttribute("data-monitoring-part") ?? "notes",
    );
    expect(order).toEqual(["area", "province", "notes"]);
  });

  it("leaves the level out on the home screen, where the hero is just above it", () => {
    const c = detailOf({ area: null, province: null, place: "home" });
    expect(c.querySelector('[data-monitoring-part="area"]')).toBeNull();
    expect(c.querySelector("[data-monitoring-noarea]")).toBeNull();
    expect(c.querySelector("[data-monitoring]")).not.toBeNull();
  });

  it("tells a visitor on the map that no area is saved, and shows them no level", () => {
    const c = detailOf({ area: null });
    expect(c.querySelector("[data-monitoring-noarea]")!.textContent).toBe(
      th.monitoring.detail.noArea,
    );
    // No level of their own. The province's counts are published levels and keep their badges.
    expect(c.querySelector('[data-monitoring-part="area"]')).toBeNull();
    expect(c.querySelector('[data-hero="alert"]')).toBeNull();
  });

  it("says the status could not be read, and draws no counts, when it could not", () => {
    const c = detailOf({
      province: {
        levels: [tally("warning", 2)],
        statusKnown: false,
        inService: true,
        scope: "ปัตตานี",
      },
    });
    expect(c.querySelector('[data-monitoring-province="unknown"]')).not.toBeNull();
    expect(c.querySelector("[data-console-level]")).toBeNull();
  });

  it("explains that no alert in force is not the same as no risk", () => {
    const c = detailOf({
      province: {
        levels: [tally("warning", 0)],
        statusKnown: true,
        inService: true,
        scope: "ปัตตานี",
      },
    });
    expect(c.querySelector('[data-monitoring-province="none"]')!.textContent).toContain(
      th.monitoring.detail.noneInForce.slice(0, 30),
    );
  });

  it("says Jaga is not in service yet rather than that no alert is in force", () => {
    const c = detailOf({
      province: {
        levels: [tally("warning", 0)],
        statusKnown: true,
        inService: false,
        scope: "ปัตตานี",
      },
    });
    expect(c.querySelector('[data-monitoring-province="notInService"]')).not.toBeNull();
    expect(c.querySelector('[data-monitoring-province="none"]')).toBeNull();
  });

  /*
   * The charts are measurements and model output, so they wear the water colour the dam's own
   * charts wear and never an alert hue, and each one carries a sentence for a screen reader.
   */
  it("draws the rivers as a count of states, saying it is not a chart over time", () => {
    const c = detailOf({
      gauges: [
        { lat: 6.9, lon: 101.3, status: "above_warning", observedAt: AT },
        { lat: 6.8, lon: 101.2, status: "normal", observedAt: AT },
        { lat: 6.7, lon: 101.1, status: "no_recent_data", observedAt: AT },
      ],
    });
    const chart = c.querySelector("[data-monitoring-chart]")!;
    expect(chart.querySelector('[role="img"]')!.getAttribute("aria-label")).toContain("3");
    expect(chart.textContent).toContain(th.monitoring.charts.gauges.note.slice(0, 20));
    expect(chart.innerHTML).not.toMatch(/alert-(normal|watch|warning|evacuate|return)/);
  });

  it("draws no charts at all when it was given no figures to draw", () => {
    expect(detailOf().querySelector("[data-monitoring-charts]")).toBeNull();
  });

  /*
   * The owner, 17 Oct 2026: a way out at the foot of the detail. By the time the charts have
   * drawn, the button that opened it is a screenful or two above.
   */
  it("ends with a way out, which the screen holding it is told about", () => {
    let shut = 0;
    const c = detailOf({ onHide: () => (shut += 1) });
    const out = c.querySelector("[data-monitoring-hide]")!;
    expect(out.textContent).toBe(th.monitoring.hideDetail);
    // Last, because it is the end of the reading and not a control at the top of it.
    expect(c.querySelector("[data-monitoring-detail]")!.lastElementChild).toBe(out);
    fireEvent.click(out);
    expect(shut).toBe(1);
  });

  it("draws no way out where the screen has not offered one", () => {
    expect(detailOf().querySelector("[data-monitoring-hide]")).toBeNull();
  });
});
