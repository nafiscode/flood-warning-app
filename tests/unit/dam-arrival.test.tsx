/**
 * When the water arrives, and the notice that says the gates have opened (spec section 15, A12).
 *
 * These two are one subject: the ranges S7 measured at the river gauges are what the dam notice
 * promises, and the alert an admin sends is the same promise with a clock put under it. What is
 * tested is what could hurt somebody:
 *
 *   1. the person is given the time of their **own** place, and the nearest one when they watch
 *      several, because that is when their water comes;
 *   2. nothing is ever a single time, and a clock time appears only where a person has said when
 *      the gates opened;
 *   3. the notice an admin sends carries every part of the template, in each language, and is
 *      built from the figures rather than typed.
 */
import { describe, expect, it } from "vitest";
import { createTranslator } from "next-intl";
import { DamArrivalLines } from "@/components/map/DamArrival";
import { DamNotice } from "@/components/map/Dam";
import type { Dam } from "@/lib/dam";
import {
  arrivalFor,
  arrivalSpan,
  arrivesAtOnce,
  clockWindow,
  spanOf,
  type DamArrival,
} from "@/lib/dam-arrival";
import type { Say } from "@/lib/dam-release";
import {
  bangkokInput,
  bangkokValue,
  releaseReason,
  releaseText,
  zoneEnds,
  zoneWindow,
} from "@/lib/dam-release";
import { exampleAlert, exampleDamSignal } from "@/lib/dev-examples";
import { damReleaseAt } from "@/lib/public-status";
import en from "@/messages/en.json";
import ms from "@/messages/ms.json";
import th from "@/messages/th.json";
import { renderWithIntl } from "./render";

/**
 * `createTranslator` types its keys to the exact message tree; the template takes any translator
 * that answers a key with a string, which is what the server action hands it.
 */
const sayFor = (locale: string, messages: Record<string, unknown>): Say => {
  const translate = createTranslator({ locale, messages, namespace: "dam" });
  return (key, values) => translate(key as never, values as never);
};

const arrival = (tambon: string, km: number, times: Partial<DamArrival> = {}): DamArrival => ({
  tambon,
  via: "main",
  kmFromDam: km,
  warnFromH: 0.8,
  earliestH: 1,
  latestH: 2,
  peakEarliestH: 3,
  peakLatestH: 4,
  source: "gauges-2026-10",
  ...times,
});

const DAM: Dam = {
  code: "bang_lang",
  name: { th: "เขื่อนบางลาง", en: "Bang Lang Dam" },
  river: { th: "แม่น้ำปัตตานี", en: "Pattani River" },
  operator: "EGAT",
  feed: "hourly" as const,
  point: null,
  spillwayPoint: null,
  outletPoint: null,
  reservoir: null,
  storageMaxMcm: 1589.8,
  storageNormalMcm: 1454.4,
  geometrySource: "osm",
  geometryNote: {},
  reaches: [],
  tambons: [
    { code: "950302", via: "main", kmFromDam: 4.3 },
    { code: "940104", via: "main", kmFromDam: 128 },
  ],
  signal: exampleDamSignal("releasing"),
  daily: null,
  days: [],
  arrivals: [
    arrival("950302", 4.3, { warnFromH: 0.5, earliestH: 0.6, latestH: 0.8 }),
    arrival("950801", 18.3, { warnFromH: 2.4, earliestH: 3, latestH: 4 }),
    arrival("940104", 128, {
      warnFromH: 12.8,
      earliestH: 16,
      latestH: 44,
      peakEarliestH: 45,
      peakLatestH: 90,
      via: "tributary",
    }),
  ],
};

describe("whose time it is", () => {
  it("gives the nearest place to the dam when someone watches several", () => {
    // Their home is in Pattani, the place they watch is up at Bannang Sata: the water reaches the
    // watched place first, and that is the hour they must hear.
    expect(arrivalFor(DAM, ["940104", "950801"])?.tambon).toBe("950801");
  });

  it("gives nothing for someone who is not on the river at all", () => {
    expect(arrivalFor(DAM, ["900101"])).toBeNull();
    expect(arrivalFor(DAM, [])).toBeNull();
  });

  it("knows the whole river, for a reader with no place of their own", () => {
    expect(arrivalSpan(DAM)).toEqual({ fromH: 0.5, toH: 44 });
    expect(arrivalSpan({ ...DAM, arrivals: [] })).toBeNull();
  });
});

describe("how a range is said", () => {
  it("keeps half hours while the water is close and whole ones after", () => {
    expect(spanOf(0.5, 0.8)).toEqual({ unit: "hours", from: 0.5, to: 1 });
    expect(spanOf(2.4, 4.2)).toEqual({ unit: "hours", from: 2, to: 4 });
  });

  it("turns into days once the far end is past two of them", () => {
    // 45-90 hours at Pattani town is four days of water, which nobody reads as 90.
    expect(spanOf(45, 90)).toEqual({ unit: "days", from: 2, to: 4 });
  });

  it("calls the dam's own doorstep 'within the hour' instead of a range of minutes", () => {
    expect(arrivesAtOnce(arrival("950401", 0, { warnFromH: 0, earliestH: 0, latestH: 0 }))).toBe(
      true,
    );
    expect(arrivesAtOnce(arrival("940104", 128, { latestH: 44 }))).toBe(false);
  });

  it("builds a clock window only from a time a person gave", () => {
    const gates = "2026-11-20T06:00:00+07:00";
    const w = clockWindow(gates, { warnFromH: 2.5, latestH: 4 })!;
    expect(w.from.toISOString()).toBe("2026-11-20T01:30:00.000Z"); // 08:30 Bangkok
    expect(w.to.toISOString()).toBe("2026-11-20T03:00:00.000Z"); // 10:00 Bangkok
    expect(clockWindow("not a time", { warnFromH: 1, latestH: 2 })).toBeNull();
  });
});

describe("what the person on the river reads", () => {
  it("names their own place and the range, and where the range comes from", () => {
    const { container } = renderWithIntl(
      <DamArrivalLines dam={DAM} tambonCodes={["950801"]} tambonName="บันนังสตา" />,
    );
    const text = container.textContent ?? "";
    expect(container.querySelector("[data-dam-arrival='main']")).toBeTruthy();
    expect(text).toContain("บันนังสตา");
    expect(text).toContain(th.dam.arrival.basis);
    // No clock time until somebody has said when the gates opened.
    expect(text).not.toMatch(/\d{2}:\d{2}/);
  });

  it("gives a clock window once a release notice has said when the gates opened", () => {
    const { container } = renderWithIntl(
      <DamArrivalLines
        dam={DAM}
        tambonCodes={["950801"]}
        tambonName="บันนังสตา"
        gatesOpenAt="2026-11-20T06:00:00+07:00"
      />,
    );
    expect(container.textContent).toMatch(/\d{2}:\d{2}/);
  });

  it("tells a place on a side stream that its time belongs to the junction", () => {
    const { container } = renderWithIntl(
      <DamArrivalLines dam={DAM} tambonCodes={["940104"]} tambonName="บานา" />,
    );
    expect(container.querySelector("[data-dam-arrival='tributary']")).toBeTruthy();
    expect(container.textContent).toContain(th.dam.arrival.tributary);
  });

  it("falls back to the whole river when the reader has no place on it", () => {
    const { container } = renderWithIntl(
      <DamArrivalLines dam={DAM} tambonCodes={[]} tambonName={null} />,
    );
    expect(container.querySelector("[data-dam-arrival='span']")).toBeTruthy();
    expect(container.textContent).toContain(th.dam.arrival.basis);
  });

  it("is in the dam notice, where the line saying nobody knew used to be", () => {
    const { container } = renderWithIntl(
      <DamNotice
        dam={DAM}
        via="main"
        tambonCode="950801"
        tambonName="บันนังสตา"
        now={Date.now()}
      />,
    );
    expect(container.querySelector("[data-dam-arrival]")).toBeTruthy();
    expect(container.textContent).not.toContain(th.dam.disclaimer.noArrivalTime);
  });
});

describe("the clock time, and the one place it can come from", () => {
  const status = (release: unknown, tambons: string[]) => ({
    generatedAt: new Date().toISOString(),
    inService: true,
    alerts: [
      {
        ...exampleAlert("warning", tambons),
        release: release as never,
      },
    ],
  });

  it("is the time a person entered when they sent the notice", () => {
    const at = "2026-11-20T06:00:00.000Z";
    const s = status(
      { damCode: "bang_lang", gatesOpenAt: at, releaseCms: 650, expectedEndAt: null },
      ["950801"],
    );
    expect(damReleaseAt(s, "bang_lang", "950801")).toBe(at);
  });

  it("is nothing for a tambon the notice does not name, or another dam, or no notice at all", () => {
    const s = status(
      {
        damCode: "bang_lang",
        gatesOpenAt: "2026-11-20T06:00:00.000Z",
        releaseCms: 650,
        expectedEndAt: null,
      },
      ["950801"],
    );
    expect(damReleaseAt(s, "bang_lang", "940104")).toBeNull();
    expect(damReleaseAt(s, "other_dam", "950801")).toBeNull();
    expect(damReleaseAt(status(null, ["950801"]), "bang_lang", "950801")).toBeNull();
    expect(damReleaseAt(null, "bang_lang", "950801")).toBeNull();
  });

  it("never comes from the hourly feed: a release with no gate time gives no clock", () => {
    const s = status({ damCode: "bang_lang", gatesOpenAt: null, releaseCms: 650 }, ["950801"]);
    expect(damReleaseAt(s, "bang_lang", "950801")).toBeNull();
  });
});

describe("the notice an admin sends", () => {
  const gates = new Date("2026-11-20T06:00:00+07:00");
  const input = {
    damName: "เขื่อนบางลาง",
    river: "แม่น้ำปัตตานี",
    operator: "EGAT",
    feed: "hourly" as const,
    gatesOpenAt: gates,
    releaseCms: 650,
    expectedEndAt: new Date("2026-11-21T06:00:00+07:00"),
    onset: zoneWindow(DAM.arrivals, gates),
  };
  const time = (at: Date) =>
    new Intl.DateTimeFormat("en", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone: "Asia/Bangkok",
    }).format(at);

  it("spans the zone from the nearest place to the furthest", () => {
    const w = zoneWindow(DAM.arrivals, gates)!;
    // 0.5 h at the first tambon, 44 h at the last.
    expect((w.from.getTime() - gates.getTime()) / 3_600_000).toBeCloseTo(0.5, 6);
    expect((w.to.getTime() - gates.getTime()) / 3_600_000).toBeCloseTo(44, 6);
    expect(zoneWindow([], gates)).toBeNull();
    expect(zoneEnds(DAM.arrivals)?.first.tambon).toBe("950302");
    expect(zoneEnds(DAM.arrivals)?.last.tambon).toBe("940104");
  });

  it("is built from the template in every language, with nothing typed by the sender", () => {
    for (const [locale, messages] of [
      ["th", th],
      ["ms", ms],
      ["en", en],
    ] as const) {
      const say = sayFor(locale, messages);
      const text = releaseText(say, time, input);
      // Every part of the template is in it, in order, and the figures are the ones given.
      expect(text).toContain("650");
      expect(text).toContain(say("release.act"));
      expect(text).toContain(say("release.estimate"));
      expect(text).toContain(say("release.issuer", { operator: "EGAT" }));
      expect(text.length).toBeGreaterThan(200);
      // No message key leaked and no unfilled placeholder.
      expect(text).not.toMatch(/[{}]/);
      expect(text).not.toContain("release.");
    }
  });

  it("leaves out the end time when nobody knows it, and keeps everything else", () => {
    const say = sayFor("th", th);
    const open = releaseText(say, time, { ...input, expectedEndAt: null });
    expect(open).not.toContain(say("release.until", { time: time(gates) }));
    expect(open).toContain(say("release.act"));
  });

  it("writes the reason line safety rule 3 puts on every screen", () => {
    const say = sayFor("th", th);
    const reason = releaseReason(say, time, input);
    expect(reason).toContain("650");
    expect(reason.length).toBeGreaterThan(10);
    expect(reason).not.toMatch(/[{}]/);
  });
});

describe("the times the sender types", () => {
  it("reads a form time as the Bangkok clock, whatever the laptop is set to", () => {
    // The owner works in UTC+3; the gates open on a Bangkok clock.
    expect(bangkokInput("2026-11-20T06:00")?.toISOString()).toBe("2026-11-19T23:00:00.000Z");
    expect(bangkokInput("")).toBeNull();
    expect(bangkokInput("20 Nov 2026")).toBeNull();
  });

  it("puts a time back into the form the same way round", () => {
    expect(bangkokValue(new Date("2026-11-19T23:00:00.000Z"))).toBe("2026-11-20T06:00");
    expect(bangkokInput(bangkokValue(new Date("2026-11-19T23:00:00.000Z")))?.toISOString()).toBe(
      "2026-11-19T23:00:00.000Z",
    );
  });
});
