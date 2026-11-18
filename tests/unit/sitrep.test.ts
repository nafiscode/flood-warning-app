/**
 * The SITREP's own logic, away from the database: the period a report covers, the document id,
 * the table, and the Word file.
 *
 * The period is what these tests mostly guard, because it is the part a reader has to be able to
 * trust: two units reporting the same flood have to be reporting the same hours, or the district
 * office cannot add their numbers up.
 */
import { describe, expect, it } from "vitest";
import en from "@/messages/en.json";
import ms from "@/messages/ms.json";
import th from "@/messages/th.json";
import { sitrepDocx, type DocxText } from "@/lib/sitrep-docx";
import {
  csvRow,
  CSV_COLUMNS,
  defaultPeriod,
  documentId,
  fileName,
  fromLocalInput,
  headlineLevel,
  LIMITS,
  MAX_DAYS,
  periodFromQuery,
  tambonRows,
  toLocalInput,
  type Sitrep,
  type SitrepTambon,
} from "@/lib/sitrep";

/** A moment in Bangkok time, as a UTC instant. */
function bangkok(iso: string): Date {
  return new Date(`${iso}+07:00`);
}

const UNIT = "0191bb7a-1234-4abc-8def-0123456789ab";

function tambon(over: Partial<SitrepTambon> = {}): SitrepTambon {
  return {
    code: "950101",
    th: "สะเตง",
    en: "Sateng",
    district_th: "เมืองยะลา",
    district_en: "Mueang Yala",
    level: null,
    new_cases: 0,
    new_people: 0,
    open_now: 0,
    waiting_now: 0,
    closed_rescued: 0,
    field_people: 0,
    reports: 0,
    roads_cut: 0,
    worst_depth: null,
    ...over,
  };
}

function sitrep(over: Partial<Sitrep> = {}): Sitrep {
  return {
    unit: { id: UNIT, name: "Yala rescue", org: "Yala Rescue Foundation", capabilities: ["rescue"] },
    from: bangkok("2026-11-17T18:00").toISOString(),
    to: bangkok("2026-11-18T18:00").toISOString(),
    generated_at: bangkok("2026-11-18T18:20").toISOString(),
    area: { tambons: 3, districts: 1, provinces: [{ th: "ยะลา", en: "Yala" }] },
    alerts_now: [],
    alerts_issued: {},
    sos: {
      new_cases: 0,
      new_rescue: 0,
      new_supplies: 0,
      new_people: 0,
      new_vulnerable: 0,
      new_spam: 0,
      merged: 0,
      open_now: 0,
      waiting_now: 0,
      closed_rescued: 0,
      closed_safe: 0,
      closed_dismissed: 0,
    },
    field_rescues: { records: 0, people: 0 },
    reports: { reports: 0, deep: 0, roads_cut: 0, rising: 0 },
    by_tambon: [],
    places: { open: 0, full: 0, closed: 0, unknown: 0, capacity_open: 0, list: [] },
    gauges: [],
    ...over,
  };
}

describe("the period a report covers", () => {
  it("ends at the last cut-off that has passed, and covers the 24 hours before it", () => {
    const p = defaultPeriod(bangkok("2026-11-18T07:30"));
    expect(p.to.toISOString()).toBe(bangkok("2026-11-18T06:00").toISOString());
    expect(p.from.toISOString()).toBe(bangkok("2026-11-17T06:00").toISOString());
    expect(p.cutOff).toBe(true);
  });

  it("uses the evening cut-off once it has passed", () => {
    const p = defaultPeriod(bangkok("2026-11-18T23:59"));
    expect(p.to.toISOString()).toBe(bangkok("2026-11-18T18:00").toISOString());
  });

  it("before the morning cut-off, reports yesterday evening's", () => {
    const p = defaultPeriod(bangkok("2026-11-18T03:00"));
    expect(p.to.toISOString()).toBe(bangkok("2026-11-17T18:00").toISOString());
    expect(p.from.toISOString()).toBe(bangkok("2026-11-16T18:00").toISOString());
  });

  it("is the same period whatever the reader's own clock says", () => {
    // The same instant, named in two zones. A unit in Bangkok and an admin in UTC+3 must get the
    // same hours, or the two copies of the report cannot be compared.
    const a = defaultPeriod(new Date("2026-11-18T12:30:00+07:00"));
    const b = defaultPeriod(new Date("2026-11-18T08:30:00+03:00"));
    expect(a.to.toISOString()).toBe(b.to.toISOString());
  });

  it("takes a period from the query, and marks it as chosen by hand", () => {
    const from = bangkok("2026-11-15T00:00");
    const to = bangkok("2026-11-17T00:00");
    const p = periodFromQuery(from.toISOString(), to.toISOString(), bangkok("2026-11-18T07:00"));
    expect(p.from.toISOString()).toBe(from.toISOString());
    expect(p.cutOff).toBe(false);
  });

  it("falls back to the default rather than erroring on a bad one", () => {
    const now = bangkok("2026-11-18T07:00");
    const fallback = defaultPeriod(now).to.toISOString();
    const bad = [
      [null, null],
      ["not a date", "also not"],
      [bangkok("2026-11-18T00:00").toISOString(), bangkok("2026-11-17T00:00").toISOString()],
      // Longer than the maximum, and a period running into the future.
      [bangkok("2026-11-01T00:00").toISOString(), bangkok("2026-11-18T00:00").toISOString()],
      [bangkok("2026-11-18T00:00").toISOString(), bangkok("2026-11-25T00:00").toISOString()],
    ] as const;
    for (const [a, b] of bad) {
      expect(periodFromQuery(a, b, now).to.toISOString()).toBe(fallback);
    }
  });

  it("holds the maximum at seven days", () => {
    expect(MAX_DAYS).toBe(7);
  });

  it("reads and writes the form's Bangkok clock, never the laptop's", () => {
    const d = bangkok("2026-11-18T18:00");
    expect(toLocalInput(d)).toBe("2026-11-18T18:00");
    expect(fromLocalInput("2026-11-18T18:00")!.toISOString()).toBe(d.toISOString());
    expect(fromLocalInput("rubbish")).toBeNull();
  });
});

describe("the document id", () => {
  it("names the cut-off day, the half of the day, and the unit", () => {
    const p = defaultPeriod(bangkok("2026-11-18T19:00"));
    expect(documentId(UNIT, p)).toBe("JAGA-SITREP-20261118-PM-0191BB7A");
    expect(fileName(UNIT, p, "docx")).toBe("jaga-sitrep-20261118-pm-0191bb7a.docx");
  });

  it("is a different id for the morning report of the same day", () => {
    const am = documentId(UNIT, defaultPeriod(bangkok("2026-11-18T07:00")));
    const pm = documentId(UNIT, defaultPeriod(bangkok("2026-11-18T19:00")));
    expect(am).not.toBe(pm);
  });
});

describe("the report's tables", () => {
  it("puts the tambons with open cases first", () => {
    const s = sitrep({
      by_tambon: [
        tambon({ code: "950102", new_cases: 9, open_now: 0 }),
        tambon({ code: "950103", open_now: 2 }),
        tambon({ code: "950104", reports: 4 }),
      ],
    });
    expect(tambonRows(s).map((t) => t.code)).toEqual(["950103", "950102", "950104"]);
  });

  it("writes a CSV row in the declared column order", () => {
    const row = csvRow(tambon({ new_cases: 2, open_now: 1, worst_depth: "waist" }), "en");
    expect(row).toHaveLength(CSV_COLUMNS.length);
    expect(row[CSV_COLUMNS.indexOf("tambon")]).toBe("Sateng");
    expect(row[CSV_COLUMNS.indexOf("worst_depth")]).toBe("waist");
    expect(csvRow(tambon(), "th")[CSV_COLUMNS.indexOf("tambon")]).toBe("สะเตง");
  });

  it("leads with the highest level in force, not the newest alert", () => {
    const s = sitrep({
      alerts_now: [
        {
          level: "watch",
          hazard: "flood",
          reason: null,
          issued_at: "",
          next_update_at: null,
          stale: false,
          automatic: false,
          tambons: [],
        },
        {
          level: "evacuate",
          hazard: "flood",
          reason: null,
          issued_at: "",
          next_update_at: null,
          stale: false,
          automatic: false,
          tambons: [],
        },
      ],
    });
    expect(headlineLevel(s)).toBe("evacuate");
    expect(headlineLevel(sitrep())).toBeNull();
  });
});

describe("the wording", () => {
  const all = { en, th, ms } as Record<string, { sitrep: Record<string, unknown> }>;

  it("is in all three languages, with the same keys", () => {
    const keys = (o: unknown, p = ""): string[] =>
      typeof o === "object" && o !== null
        ? Object.entries(o).flatMap(([k, v]) => keys(v, `${p}.${k}`))
        : [p];
    const base = keys(all.en!.sitrep).sort();
    expect(keys(all.th!.sitrep).sort()).toEqual(base);
    expect(keys(all.ms!.sitrep).sort()).toEqual(base);
  });

  it("carries all four limits in every language", () => {
    for (const [locale, messages] of Object.entries(all)) {
      const limits = messages.sitrep.limits as Record<string, string>;
      for (const key of LIMITS) {
        expect(limits[key], `${locale}.${key}`).toBeTruthy();
      }
      // The hotlines, in a document that is read where there is no app (safety rule 4).
      expect(limits.hotlines).toContain("1784");
      expect(limits.hotlines).toContain("1669");
    }
  });

  it("never calls the report an alert, or a forecast of anything", () => {
    for (const [locale, messages] of Object.entries(all)) {
      const text = JSON.stringify(messages.sitrep);
      for (const forbidden of ["จะท่วม", "คาดว่าจะเกิดน้ำท่วม", "will flood", "akan banjir"]) {
        expect(text, `${locale}: ${forbidden}`).not.toContain(forbidden);
      }
    }
  });
});

describe("the Word file", () => {
  const text: DocxText = {
    kicker: "Jaga",
    title: "Situation report",
    unitLine: "Yala rescue",
    period: "Period: 17 Nov 18:00 to 18 Nov 18:00",
    areaLine: "3 tambons",
    docLine: "Document JAGA-SITREP-20261118-PM-0191BB7A",
    alertsTitle: "Alerts in force",
    alertsNone: "No alert is in force",
    alertsHeadline: "Highest level: Warning",
    alertsIssued: null,
    alertRows: [
      {
        level: "Warning",
        tambons: "Sateng",
        reason: "river at warning",
        times: "Issued 18 Nov 06:00",
        stale: "Not updated since 18 Nov 12:00. The level still stands.",
      },
    ],
    figuresTitle: "Figures",
    figures: [{ label: "New requests", value: "4" }],
    breakdown: "Of the new requests: 3 for rescue",
    flagged: null,
    byTambonTitle: "By tambon",
    byTambonNone: "Nothing recorded",
    tableHead: ["Tambon", "New"],
    tableRows: [["Sateng", "4"]],
    placesTitle: "Safe places",
    placesCounts: "2 open",
    placesRows: ["Wat Khuhaphimuk · open"],
    gaugesTitle: "River gauges",
    gaugeRows: ["X.40A · 12.4 m"],
    limitsTitle: "What this shows",
    limits: ["It is counts"],
    hotlines: "1784 · 1669",
    credit: "ThaiWater, Open-Meteo",
    footer: "Jaga situation report",
  };

  it("builds a .docx with the report's words in it", async () => {
    const buffer = await sitrepDocx(
      sitrep({ by_tambon: [tambon({ new_cases: 4 })] }),
      defaultPeriod(bangkok("2026-11-18T19:00")),
      text,
    );
    // A .docx is a zip: "PK" and then the parts.
    expect(buffer.subarray(0, 2).toString("latin1")).toBe("PK");
    expect(buffer.length).toBeGreaterThan(2000);
    const zip = buffer.toString("latin1");
    expect(zip).toContain("word/document.xml");
  });

  it("builds one for a quiet period too, with the limits still in it", async () => {
    const buffer = await sitrepDocx(
      sitrep(),
      defaultPeriod(bangkok("2026-11-18T07:00")),
      { ...text, alertRows: [], tableRows: [], placesRows: [], gaugeRows: [] },
    );
    expect(buffer.length).toBeGreaterThan(2000);
  });
});
