import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Dam, DamSignal } from "@/lib/dam";
import type { TambonReports } from "@/lib/flood-reports";
import type { Gauge } from "@/lib/map-data";
import {
  GAUGES_NEAR_KM,
  gaugesNear,
  monitoring,
  type Feed,
  type MonitoringInput,
  type Note,
  type RainReading,
} from "@/lib/monitoring";

/*
 * The whole point of this module is that nothing in it is a level and that silence is never read
 * as safety. The tests are written around those two promises first and the arithmetic second.
 */

const NOW = Date.parse("2026-11-20T07:00:00.000Z");

const gauge = (over: Partial<Gauge> = {}): Gauge => ({
  id: "g",
  name: { th: "สถานี" },
  lat: 6.8,
  lon: 101.2,
  value: 3,
  observedAt: "2026-11-20T06:00:00.000Z",
  status: "normal",
  ...over,
});

const tambon = (over: Partial<TambonReports> = {}): TambonReports => ({
  tambon: "940101",
  nameTh: "ตำบล",
  nameEn: "Tambon",
  district: "9401",
  districtTh: "อำเภอ",
  districtEn: "District",
  lat: 6.8,
  lon: 101.2,
  reports: 1,
  people: 1,
  deepest: null,
  worstRoad: null,
  trend: null,
  firstAt: "2026-11-20T02:00:00.000Z",
  latestAt: "2026-11-20T05:00:00.000Z",
  confirmed: false,
  ...over,
});

const signal = (over: Partial<DamSignal> = {}): DamSignal =>
  ({
    observedAt: "2026-11-20T06:00:00.000Z",
    percentFull: 60,
    outflowCms: 20,
    releasedCms: 20,
    spilledCms: null,
    inflowCms: null,
    grade: "quiet",
    reasons: [],
    awaiting: [],
    stale: false,
    ...over,
  }) as unknown as DamSignal;

const dam = (over: Partial<Dam> = {}): Dam =>
  ({
    code: "banglang",
    name: { th: "เขื่อนบางลาง" },
    signal: signal(),
    days: [],
    storageMaxMcm: 1454,
    storageNormalMcm: 1000,
    ...over,
  }) as unknown as Dam;

const ok = <T>(data: T): Feed<T> => ({ state: "ok", data });
const failed = <T>(): Feed<T> => ({ state: "unavailable", data: null });
const loading = <T>(): Feed<T> => ({ state: "loading", data: null });

function input(over: Partial<MonitoringInput> = {}): MonitoringInput {
  return {
    now: NOW,
    myCodes: [],
    myPoint: null,
    narrowed: false,
    gauges: ok([gauge()]),
    dam: ok(dam()),
    onMyRiver: false,
    reports: ok([]),
    ...over,
  };
}

const noteOf = (notes: Note[], kind: Note["kind"]) => notes.find((n) => n.kind === kind)!;

describe("what the monitoring shows now: the rivers", () => {
  it("says it could not read them when the feed failed, and never that they are below their bank", () => {
    const { notes } = monitoring(input({ gauges: failed() }));
    expect(noteOf(notes, "gauges").say).toBe("unknown");
    expect(notes.some((n) => n.kind === "gauges" && n.say === "quiet")).toBe(false);
  });

  it("says it could not read them while the feed is still being asked for", () => {
    expect(noteOf(monitoring(input({ gauges: loading() })).notes, "gauges").say).toBe("unknown");
  });

  it("says it could not read them when Jaga watches no station at all", () => {
    expect(noteOf(monitoring(input({ gauges: ok([]) })).notes, "gauges").say).toBe("unknown");
  });

  /*
   * The rule this module exists for. "Every gauge is silent" and "every river is below its bank"
   * are opposite facts; a feed that answers with nobody reporting must never be drawn as the
   * second one (safety rule 10).
   */
  it("says it could not read them when every gauge has been silent, never that all is quiet", () => {
    const silent = [
      gauge({ status: "no_recent_data" }),
      gauge({ status: "no_recent_data" }),
      gauge({ status: "no_recent_data" }),
    ];
    const note = noteOf(monitoring(input({ gauges: ok(silent) })).notes, "gauges");
    expect(note.say).toBe("unknown");
    expect(note.kind === "gauges" && note.silent).toBe(3);
  });

  it("puts a river at or over its bank at the top weight", () => {
    const note = noteOf(
      monitoring(input({ gauges: ok([gauge({ status: "above_warning" }), gauge()]) })).notes,
      "gauges",
    );
    expect(note.say).toBe("active");
    expect(note.weight).toBe(2);
    expect(note.kind === "gauges" && note.over).toBe(1);
  });

  it("puts a river only near its bank below one over it", () => {
    const note = noteOf(
      monitoring(input({ gauges: ok([gauge({ status: "above_watch" })]) })).notes,
      "gauges",
    );
    expect(note.say).toBe("active");
    expect(note.weight).toBe(1);
  });

  it("is quiet, with its figures and its time, when gauges report and all read below their bank", () => {
    const note = noteOf(
      monitoring(input({ gauges: ok([gauge(), gauge({ status: "no_recent_data" })]) })).notes,
      "gauges",
    );
    expect(note.say).toBe("quiet");
    expect(note.kind === "gauges" && note.reporting).toBe(1);
    expect(note.kind === "gauges" && note.total).toBe(2);
    expect(note.at).toBe("2026-11-20T06:00:00.000Z");
    expect(note.ageMin).toBe(60);
  });
});

describe("which rivers are the person's own", () => {
  const here = { lat: 6.8, lon: 101.2 };

  it("counts a gauge a few kilometres away and leaves out one in the next province", () => {
    const near = gauge({ id: "near", lat: 6.85, lon: 101.25 });
    const far = gauge({ id: "far", lat: 7.6, lon: 100.2 });
    const kept = gaugesNear([near, far], here);
    expect(kept.map((g) => g.id)).toEqual(["near"]);
  });

  it("measures the distance, not a bounding box, so a station is never in two provinces at once", () => {
    // 50 km north is in; a touch over is out. The figure is the one constant, not a per-province box.
    const inside = gauge({ id: "in", lat: here.lat + 0.44, lon: here.lon });
    const outside = gauge({ id: "out", lat: here.lat + 0.46, lon: here.lon });
    expect(gaugesNear([inside, outside], here, GAUGES_NEAR_KM).map((g) => g.id)).toEqual(["in"]);
  });

  it("says 'near you' once an area is saved, and 'all four provinces' before that", () => {
    const withArea = monitoring(input({ myPoint: here, gauges: ok([gauge()]) }));
    expect(noteOf(withArea.notes, "gauges").scope).toBe("nearMe");
    const visitor = monitoring(input({ gauges: ok([gauge()]) }));
    expect(noteOf(visitor.notes, "gauges").scope).toBe("fourProvinces");
  });

  it("counts only the person's own rivers once they have an area", () => {
    const gauges = ok([gauge({ status: "above_warning", lat: 7.6, lon: 100.2 }), gauge()]);
    // The one over its bank is far away: near this person every river is below its bank.
    const note = noteOf(monitoring(input({ myPoint: here, gauges })).notes, "gauges");
    expect(note.say).toBe("quiet");
    expect(note.kind === "gauges" && note.total).toBe(1);
  });
});

describe("what the monitoring shows now: the dam", () => {
  it("says it could not read the dam when it has published nothing, never that it is quiet", () => {
    const note = noteOf(monitoring(input({ dam: ok(dam({ signal: null })) })).notes, "dam");
    expect(note.say).toBe("unknown");
  });

  it("says it could not read the dam when the feed failed", () => {
    expect(noteOf(monitoring(input({ dam: failed() })).notes, "dam").say).toBe("unknown");
  });

  it("puts a dam that is releasing at the top weight", () => {
    const note = noteOf(
      monitoring(input({ dam: ok(dam({ signal: signal({ grade: "releasing" }) })) })).notes,
      "dam",
    );
    expect(note.say).toBe("active");
    expect(note.weight).toBe(2);
    expect(note.kind === "dam" && note.attention).toBe("releasing");
  });

  it("puts water over the spillway at the top weight even when the grade is quiet", () => {
    const note = noteOf(
      monitoring(input({ dam: ok(dam({ signal: signal({ spilledCms: 5 }) })) })).notes,
      "dam",
    );
    expect(note.weight).toBe(2);
  });

  it("asks for an eye when one reading alone has met a release rule", () => {
    const note = noteOf(
      monitoring(input({ dam: ok(dam({ signal: signal({ awaiting: ["release_unconfirmed"] }) })) }))
        .notes,
      "dam",
    );
    expect(note.say).toBe("active");
    expect(note.weight).toBe(1);
    expect(note.kind === "dam" && note.attention).toBe("awaiting");
  });

  it("asks for an eye when the reservoir is past the share it is normally held at", () => {
    const note = noteOf(
      monitoring(input({ dam: ok(dam({ signal: signal({ percentFull: 90 }) })) })).notes,
      "dam",
    );
    expect(note.say).toBe("active");
    expect(note.weight).toBe(1);
    expect(note.kind === "dam" && note.pastNormal).toBe(true);
  });

  /* Stale is a marker, never a downgrade (safety rule 3): the figures keep their meaning. */
  it("keeps a late reading's state, weight and figures, and only marks it late", () => {
    const late = signal({ grade: "releasing", stale: true, outflowCms: 300 });
    const note = noteOf(monitoring(input({ dam: ok(dam({ signal: late })) })).notes, "dam");
    expect(note.say).toBe("active");
    expect(note.weight).toBe(2);
    expect(note.kind === "dam" && note.stale).toBe(true);
    expect(note.kind === "dam" && note.outflowCms).toBe(300);
  });

  it("says the dam is on the person's own river when the screen says so", () => {
    expect(noteOf(monitoring(input({ onMyRiver: true })).notes, "dam").scope).toBe("myAreas");
    expect(noteOf(monitoring(input()).notes, "dam").scope).toBe("fourProvinces");
  });

  /*
   * The owner, 18 Oct 2026: where a reader's own places are not reached by a release or a rise,
   * the dam is left out altogether rather than reported as unreadable.
   */
  it("is left out for a reader whose own places the dam cannot reach", () => {
    const { notes } = monitoring(input({ myCodes: ["940101"], onMyRiver: false }));
    expect(notes.some((n) => n.kind === "dam")).toBe(false);
    // And leaving it out never makes the rest look incomplete.
    expect(notes.every((n) => n.kind !== "dam")).toBe(true);
  });

  it("stays for a reader the dam's river runs through", () => {
    const { notes } = monitoring(input({ myCodes: ["940101"], onMyRiver: true }));
    expect(noteOf(notes, "dam").say).toBe("quiet");
  });

  /* Never silent about an event: a release is told to everybody, whatever its modelled reach. */
  it("stays for everybody while the dam is actually doing something", () => {
    const releasing = ok(dam({ signal: signal({ grade: "releasing", outflowCms: 300 }) }));
    const { notes } = monitoring(input({ myCodes: ["940101"], onMyRiver: false, dam: releasing }));
    expect(noteOf(notes, "dam").say).toBe("active");
  });

  it("stays for a visitor who has saved no place, who is shown all four provinces anyway", () => {
    expect(noteOf(monitoring(input({ myCodes: [] })).notes, "dam").say).toBe("quiet");
  });

  /*
   * Two silences, told apart (the owner, 18 Oct): the station publishing nothing for this moment
   * is the station being quiet, not Jaga failing to read it.
   */
  it("says whether it was the station or the request that gave nothing", () => {
    const quietStation = noteOf(monitoring(input({ dam: ok(dam({ signal: null })) })).notes, "dam");
    expect(quietStation.kind === "dam" && quietStation.noFigures).toBe("reading");
    const noAnswer = noteOf(monitoring(input({ dam: failed() })).notes, "dam");
    expect(noAnswer.kind === "dam" && noAnswer.noFigures).toBe("feed");
    const figures = noteOf(monitoring(input()).notes, "dam");
    expect(figures.kind === "dam" && figures.noFigures).toBeNull();
  });
});

describe("what the monitoring shows now: residents' reports", () => {
  it("says it could not load them when the request failed, never that none stand", () => {
    const note = noteOf(monitoring(input({ reports: failed() })).notes, "reports");
    expect(note.say).toBe("unknown");
    expect(notesSaying(monitoring(input({ reports: failed() })).notes, "quiet")).not.toContain(
      "reports",
    );
  });

  it("is quiet when the request answered with nothing standing", () => {
    expect(noteOf(monitoring(input({ reports: ok([]) })).notes, "reports").say).toBe("quiet");
  });

  it("counts standing reports and asks for an eye when several residents agree", () => {
    const rows = [tambon({ reports: 3, people: 3, confirmed: true })];
    const note = noteOf(monitoring(input({ reports: ok(rows) })).notes, "reports");
    expect(note.say).toBe("active");
    expect(note.weight).toBe(2);
    expect(note.kind === "reports" && note.reports).toBe(3);
  });

  it("weighs a report in the person's own subdistrict above one merely nearby", () => {
    const rows = [tambon({ tambon: "940101", reports: 1 })];
    expect(monitoring(input({ reports: ok(rows), myCodes: ["940101"] })).notes[0]!.weight).toBe(2);
    const elsewhere = noteOf(
      monitoring(input({ reports: ok(rows), myCodes: ["960101"] })).notes,
      "reports",
    );
    expect(elsewhere.weight).toBe(1);
    expect(elsewhere.kind === "reports" && elsewhere.here).toBe(0);
  });

  it("reaches as far as the screen does: the person's places, else the province, else all four", () => {
    expect(noteOf(monitoring(input({ myCodes: ["940101"] })).notes, "reports").scope).toBe(
      "myAreas",
    );
    expect(noteOf(monitoring(input({ narrowed: true })).notes, "reports").scope).toBe("province");
    expect(noteOf(monitoring(input()).notes, "reports").scope).toBe("fourProvinces");
  });
});

describe("what the monitoring shows now: the rain", () => {
  const reading = (over: Partial<RainReading> = {}): RainReading => ({
    group: "clear",
    rainMm: 0,
    at: "2026-11-20T06:30:00.000Z",
    ...over,
  });

  it("is left out entirely when the device knows no weather place", () => {
    expect(monitoring(input()).notes.some((n) => n.kind === "rain")).toBe(false);
  });

  it("says no reading is kept rather than that it is dry", () => {
    const note = noteOf(monitoring(input({ rain: failed() })).notes, "rain");
    expect(note.say).toBe("unknown");
  });

  it("reports rain falling in the model", () => {
    const note = noteOf(
      monitoring(input({ rain: ok(reading({ group: "rain", rainMm: 4 })) })).notes,
      "rain",
    );
    expect(note.say).toBe("active");
    expect(note.weight).toBe(1);
  });

  it("puts a thunderstorm and heavy rain at the top weight", () => {
    for (const group of ["thunder", "rainHeavy", "showersHeavy", "thunderHail"] as const) {
      const note = noteOf(monitoring(input({ rain: ok(reading({ group })) })).notes, "rain");
      expect(note.weight).toBe(2);
    }
  });

  it("reads a model's trace of rain as dry", () => {
    const note = noteOf(monitoring(input({ rain: ok(reading({ rainMm: 0.05 })) })).notes, "rain");
    expect(note.say).toBe("quiet");
    expect(note.kind === "rain" && note.wet).toBe(false);
  });

  it("keeps an old reading's figures and only marks it old", () => {
    const old = reading({ group: "rain", rainMm: 3, at: "2026-11-20T02:00:00.000Z" });
    const note = noteOf(monitoring(input({ rain: ok(old) })).notes, "rain");
    expect(note.say).toBe("active");
    expect(note.kind === "rain" && note.stale).toBe(true);
    expect(note.kind === "rain" && note.rainMm).toBe(3);
  });
});

const notesSaying = (notes: Note[], say: Note["say"]) =>
  notes.filter((n) => n.say === say).map((n) => n.kind);

describe("how the notes are read together", () => {
  it("puts what is happening first, then what could not be read, then what is quiet", () => {
    const summary = monitoring(
      input({
        gauges: ok([gauge({ status: "above_watch" })]),
        dam: failed(),
        reports: ok([]),
        rain: ok({ group: "rain", rainMm: 2, at: "2026-11-20T06:45:00.000Z" }),
      }),
    );
    expect(summary.notes.map((n) => n.say)).toEqual(["active", "active", "unknown", "quiet"]);
  });

  it("puts a river over its bank above one merely near it", () => {
    const summary = monitoring(
      input({
        gauges: ok([gauge({ status: "above_warning" })]),
        dam: ok(dam({ signal: signal({ awaiting: ["watch_unconfirmed"] }) })),
      }),
    );
    expect(summary.notes[0]!.kind).toBe("gauges");
    expect(summary.notes[0]!.weight).toBe(2);
  });

  it("says the list is incomplete when one feed could not be read", () => {
    const summary = monitoring(input({ reports: failed() }));
    expect(summary.anyUnknown).toBe(true);
    expect(summary.allUnknown).toBe(false);
  });

  it("says nothing at all could be read when every feed failed", () => {
    const summary = monitoring(
      input({ gauges: failed(), dam: failed(), reports: failed(), rain: failed() }),
    );
    expect(summary.allUnknown).toBe(true);
    expect(summary.notes.every((n) => n.say === "unknown")).toBe(true);
    expect(notesSaying(summary.notes, "quiet")).toEqual([]);
  });

  it("keeps the newest measurement of them all", () => {
    const summary = monitoring(
      input({
        gauges: ok([gauge({ observedAt: "2026-11-20T06:00:00.000Z" })]),
        reports: ok([tambon({ latestAt: "2026-11-20T06:50:00.000Z" })]),
      }),
    );
    expect(summary.newestAt).toBe("2026-11-20T06:50:00.000Z");
  });

  it("gives no age at all on the server, where there is no clock yet", () => {
    const summary = monitoring(input({ now: 0 }));
    expect(summary.notes.every((n) => n.ageMin === null || n.ageMin >= 0)).toBe(true);
    expect(noteOf(summary.notes, "gauges").ageMin).toBeNull();
  });
});

/*
 * These two hold the promises the module is built on, and they hold them against the source
 * rather than against behaviour, because that is the kind of promise they are.
 */
describe("the promises this module makes", () => {
  const source = readFileSync("lib/monitoring.ts", "utf8");

  it("never summarises the whole picture into one field, which would be a level in all but name", () => {
    const summary = monitoring(input());
    expect(Object.keys(summary).sort()).toEqual(["allUnknown", "anyUnknown", "newestAt", "notes"]);
    for (const note of summary.notes) {
      expect(Object.keys(note)).not.toContain("level");
    }
  });

  /*
   * It cannot produce a level because it never holds one: the alert levels and their palette live
   * in @/lib/brand/tokens, and this module does not import it. The one level-shaped word it does
   * contain is `"watch"`, and only as the dam's own `DamAttention` value - which is why the dam
   * note carries `attention()` and never `damLevel()`, the vocabulary brand.md lets the dam's
   * chip wear in alert hues.
   */
  /** The source with its prose taken out: the comments discuss what the code must not do. */
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");

  it("cannot hold a level: it imports neither the alert palette nor the admins' suggestion", () => {
    expect(code).not.toContain("@/lib/brand/tokens");
    expect(code).not.toContain("@/lib/signals");
    expect(code).not.toContain("AlertLevel");
    expect(code).not.toContain("damLevel");
  });

  it("speaks none of the levels' own words, and never names an alert colour", () => {
    for (const level of ['"normal"', '"warning"', '"evacuate"', '"return"']) {
      expect(code).not.toContain(level);
    }
    expect(code).not.toContain("alert-");
    // "watch" is allowed only as the dam's attention, nowhere else.
    expect(code.match(/"watch"/g) ?? []).toHaveLength(1);
  });
});
