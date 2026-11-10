/**
 * A19, where a road may be holding water back: the wording and the reasons.
 *
 * The two things worth a test here are both about what the page must never say or wear.
 *
 *   * **No wording may claim the road blocks the flood** (safety rule 8). The radar sees extent,
 *     not depth; the whole feature is "look here first", and the reviewed wording in all three
 *     languages has to stay on that side of the line. The check below is crude on purpose - a
 *     word list - because the failure it guards against is somebody writing a confident sentence
 *     in a hurry, not somebody being subtle.
 *   * **No alert colour may appear** (safety rules 2 and 10). These are not levels, and a violet
 *     line on a map must never be mistaken for an orange or a red one.
 */
import en from "@/messages/en.json";
import ms from "@/messages/ms.json";
import th from "@/messages/th.json";
import { describe, expect, it } from "vitest";
import {
  ALL_CLASSES,
  CLASS_LOOK,
  chosenProvince,
  FLAGGED,
  LIMITS,
  mapSearchLink,
  NOTE_STATUSES,
  noteStatus,
  reasonsFor,
  roadLabel,
  type StretchRow,
} from "@/lib/highway-paths";

const LOCALES = { th: th.highwayPaths, en: en.highwayPaths, ms: ms.highwayPaths };

/** Every string in a namespace, flattened, with the key that holds it. */
function strings(value: unknown, path = ""): [string, string][] {
  if (typeof value === "string") return [[path, value]];
  if (!value || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
    strings(v, path ? `${path}.${k}` : k),
  );
}

const row = (over: Partial<StretchRow> = {}): StretchRow => ({
  id: "R04339",
  klass: "look_first",
  rank: 1,
  score: 0.98,
  km: 0.5,
  sections: 1,
  runId: "c97e0bf",
  runDate: "2026-10-15",
  sectionId: "S04339",
  roadKind: "trunk",
  roadRef: "42",
  roadNameTh: null,
  roadNameEn: null,
  districtTh: "โคกโพธิ์",
  districtEn: "Khok Pho",
  tambonTh: "มะกรูด",
  tambonEn: "Makrut",
  tambonCode: "940202",
  lat: 6.738339,
  lon: 101.12342,
  upstreamSide: "left",
  upstreamBy: "d8",
  d8DemAgree: null,
  asymmetry: 0.307,
  seasonsSeen: 9,
  seasonsUpWetter: 8,
  seasonsDownWetter: 0,
  persistence: 0.0789,
  passesSeen: 122,
  passesFloodedUp: 38,
  passesFloodedDown: 0,
  crossingKm2: 54.74,
  crossingFrom: "left",
  crossingOpening: "waterway",
  crossingOpeningM: 249,
  crossingLat: 6.738145,
  crossingLon: 101.122879,
  noteStatus: null,
  note: null,
  noteAt: null,
  noteUnit: null,
  ...over,
});

describe("the wording never claims a road blocks the flood", () => {
  /*
   * Phrases that would turn "the radar record looks like this" into a finding of fact. English
   * and the two others: the Thai and Malay words are the ones a translator would reach for if
   * they tightened the sentence, which is exactly the slip to catch.
   */
  const FORBIDDEN = [
    /\bblocks the flood\b/i,
    /\bblocks the water\b/i,
    /\bdams the\b/i,
    /\bis holding the water\b/i,
    /\bcauses the flood/i,
    /\bproves\b/i,
    /\bconfirmed\b/i,
    /กั้นน้ำไว้/,
    /ทำให้น้ำท่วม/,
    /ยืนยันว่า/,
    /พิสูจน์/,
    /menahan air banjir/i,
    /membuktikan/i,
    /mengesahkan bahawa/i,
  ];

  for (const [locale, block] of Object.entries(LOCALES)) {
    it(`holds in ${locale}`, () => {
      for (const [key, text] of strings(block)) {
        for (const pattern of FORBIDDEN) {
          expect(pattern.test(text), `${locale}.${key}: ${text}`).toBe(false);
        }
      }
    });
  }

  it("says in every language that this is not an alert", () => {
    for (const [locale, block] of Object.entries(LOCALES)) {
      expect(block.notAlert.length, locale).toBeGreaterThan(20);
      expect(block.map.legendNote.length, locale).toBeGreaterThan(10);
    }
  });

  it("carries all four limits, in all three languages, with nothing empty", () => {
    for (const [locale, block] of Object.entries(LOCALES)) {
      for (const key of LIMITS) {
        const text = (block.limits as Record<string, string | undefined>)[key];
        expect(typeof text, `${locale}.limits.${key}`).toBe("string");
        expect(text?.length ?? 0, `${locale}.limits.${key}`).toBeGreaterThan(30);
      }
    }
  });

  it("has the same keys in all three languages", () => {
    const keys = (block: unknown) =>
      strings(block)
        .map(([k]) => k)
        .sort();
    expect(keys(LOCALES.en)).toEqual(keys(LOCALES.th));
    expect(keys(LOCALES.ms)).toEqual(keys(LOCALES.th));
  });

  it("names every class and every note status in all three languages", () => {
    for (const [locale, block] of Object.entries(LOCALES)) {
      for (const klass of ALL_CLASSES) {
        const named = (block.klass as Record<string, { name: string; lead: string }>)[klass];
        expect(named?.name, `${locale}.klass.${klass}`).toBeTruthy();
        expect(named?.lead, `${locale}.klass.${klass}`).toBeTruthy();
      }
      for (const status of NOTE_STATUSES) {
        expect(
          (block.note.status as Record<string, string>)[status],
          `${locale}.note.status.${status}`,
        ).toBeTruthy();
      }
    }
  });
});

describe("the classes wear no alert colour", () => {
  /** docs/brand.md: the alert palette, plus the SOS red and the stale grey. */
  const ALERT = ["#2f7a25", "#f2c230", "#f07f1a", "#c62828", "#1f6fd1", "#6b7780"];
  /** lib/hazard-layer.ts: the flood-hazard pinks these lines are drawn on top of. */
  const HAZARD = ["#7a1238", "#db6a9a", "#f2b8c6", "#ffc4d6", "#e0679e", "#7e5c74"];
  /** docs/brand.md: brand slate and teal never show a status. */
  const BRAND = ["#1d3b53", "#2f9c95", "#1f7a74", "#7fd1c9"];

  it("uses none of the alert, hazard or brand colours, by day or by night", () => {
    const used = ALL_CLASSES.flatMap((k) => [
      CLASS_LOOK[k].color.toLowerCase(),
      CLASS_LOOK[k].night.toLowerCase(),
    ]);
    for (const colour of used) {
      expect(ALERT, colour).not.toContain(colour);
      expect(HAZARD, colour).not.toContain(colour);
      expect(BRAND, colour).not.toContain(colour);
    }
  });

  it("keeps a clear distance from every alert colour, not just a different code", () => {
    const rgb = (hex: string) => [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16),
    ];
    const far = (a: string, b: string) => {
      const [r1, g1, b1] = rgb(a) as [number, number, number];
      const [r2, g2, b2] = rgb(b) as [number, number, number];
      return Math.hypot(r1 - r2, g1 - g2, b1 - b2);
    };
    for (const klass of ALL_CLASSES) {
      for (const hex of [CLASS_LOOK[klass].color, CLASS_LOOK[klass].night]) {
        for (const alert of ALERT) {
          expect(far(hex, alert), `${klass} ${hex} vs ${alert}`).toBeGreaterThan(60);
        }
      }
    }
  });

  it("gives the two classes an office acts on the heaviest lines", () => {
    for (const flagged of FLAGGED) {
      expect(CLASS_LOOK[flagged].width).toBeGreaterThan(CLASS_LOOK.no_sign.width);
    }
    expect(CLASS_LOOK.look_first.width).toBeGreaterThan(CLASS_LOOK.worth_a_look.width);
    // The radar having seen nothing is drawn as a dashed line, never as a solid "no sign".
    expect(CLASS_LOOK.not_seen.dashed).toBe(true);
    expect(CLASS_LOOK.no_sign.dashed).toBe(false);
  });
});

describe("the reasons a stretch is on the list", () => {
  it("says the difference, the seasons, the passes, the crossing and how sure the side is", () => {
    const keys = reasonsFor(row()).map((r) => r.key);
    expect(keys).toEqual([
      "asymmetry",
      "seasons",
      "passes",
      "crossing",
      "openingFar",
      "sideBy_d8",
    ]);
  });

  it("turns the asymmetry into whole percentage points", () => {
    const found = reasonsFor(row()).find((r) => r.key === "asymmetry")!;
    expect(found.values).toEqual({ side: "left", points: 31, seasons: 9 });
  });

  it("says there is no mapped opening when none was found at all", () => {
    const keys = reasonsFor(row({ crossingOpening: null, crossingOpeningM: null })).map(
      (r) => r.key,
    );
    expect(keys).toContain("noOpeningAtAll");
    expect(keys).not.toContain("openingFar");
  });

  it("separates an opening at the crossing from one far away", () => {
    expect(reasonsFor(row({ crossingOpeningM: 40 })).map((r) => r.key)).toContain("openingNear");
    expect(reasonsFor(row({ crossingOpeningM: 400 })).map((r) => r.key)).toContain("openingFar");
  });

  it("says plainly when the upstream side could not be decided", () => {
    const keys = reasonsFor(row({ upstreamBy: "unclear", upstreamSide: null })).map((r) => r.key);
    expect(keys).toContain("sideUnclear");
    expect(keys.some((k) => k.startsWith("sideBy_"))).toBe(false);
    // And with no side there is no claim about which side was wetter.
    expect(keys).not.toContain("asymmetry");
  });

  it("warns when the flow directions and the ground heights disagree", () => {
    expect(reasonsFor(row({ d8DemAgree: false })).map((r) => r.key)).toContain("sideDisagree");
    expect(reasonsFor(row({ d8DemAgree: true })).map((r) => r.key)).not.toContain("sideDisagree");
  });

  it("leaves out a reason whose figure is missing, rather than printing a zero", () => {
    const keys = reasonsFor(
      row({
        asymmetry: null,
        seasonsUpWetter: 0,
        passesFloodedUp: 0,
        crossingKm2: null,
      }),
    ).map((r) => r.key);
    expect(keys).toEqual(["sideBy_d8"]);
  });

  it("never claims an advantage from a negative asymmetry", () => {
    expect(reasonsFor(row({ asymmetry: -0.1 })).map((r) => r.key)).not.toContain("asymmetry");
  });
});

describe("the small helpers", () => {
  it("names a road by its number, or says the number is not in the map data", () => {
    expect(roadLabel(row(), "th").ref).toBe("42");
    expect(roadLabel(row({ roadRef: null }), "th").ref).toBeNull();
  });

  it("prefers the Thai road name in Thai and the English one elsewhere", () => {
    const both = row({ roadNameTh: "ถนนเพชรเกษม", roadNameEn: "Phetkasem Road" });
    expect(roadLabel(both, "th").name).toBe("ถนนเพชรเกษม");
    expect(roadLabel(both, "en").name).toBe("Phetkasem Road");
    // Only one of the two: whichever exists.
    expect(roadLabel(row({ roadNameEn: "Phetkasem Road" }), "th").name).toBe("Phetkasem Road");
  });

  it("links a point with latitude first, as a maps search wants it", () => {
    expect(mapSearchLink(6.738339, 101.12342)).toContain("query=6.738339,101.123420");
  });

  it("falls back to the first province this account may read", () => {
    const mine = [
      { code: "94", nameTh: "ปัตตานี", nameEn: "Pattani" },
      { code: "95", nameTh: "ยะลา", nameEn: "Yala" },
    ];
    expect(chosenProvince(mine, "95")?.code).toBe("95");
    // A province this account may not read is never shown: it falls back, never through.
    expect(chosenProvince(mine, "90")?.code).toBe("94");
    expect(chosenProvince(mine, undefined)?.code).toBe("94");
    expect(chosenProvince([], "94")).toBeNull();
  });

  it("accepts only the six note statuses", () => {
    expect(noteStatus("checked_ground")).toBe("checked_ground");
    expect(noteStatus("whatever")).toBeNull();
    expect(noteStatus(null)).toBeNull();
    expect(NOTE_STATUSES).toHaveLength(6);
  });
});
