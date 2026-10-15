import { describe, expect, it } from "vitest";
import { SeaSection } from "@/components/map/Sea";
import { mapMessages } from "@/lib/messages";
import {
  COAST_POINTS,
  coastGrade,
  isCoastId,
  marineUrl,
  nearestCoast,
  outlook,
  SEA_LIMITS,
  tide,
  toSea,
  travelBearing,
  waveRange,
  type SeaData,
  type SeaHour,
} from "@/lib/sea";
import { SEA_LOOKS } from "@/lib/sea-marks";
import en from "@/messages/en.json";
import ms from "@/messages/ms.json";
import th from "@/messages/th.json";
import { renderWithIntl } from "./render";

/**
 * The Sea and coast section (the owner, 15 Oct 2026): waves and tide off the coast and a graded
 * note for fishermen that never says the sea is safe (safety rules 2 and 8).
 */

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 10, 20, 3); // 10:00 in Bangkok

function hours(over: (i: number) => Partial<SeaHour> = () => ({}), count = 48): SeaHour[] {
  return Array.from({ length: count }, (_, i) => ({
    t: NOW - 6 * HOUR + i * HOUR,
    wave: 0.3,
    waveFrom: 45,
    period: 5,
    swell: 0.2,
    wind: 12,
    gust: 20,
    code: 3,
    // A tide with a period of about 12.4 hours.
    sea: Math.sin(((i - 6) / 12.4) * 2 * Math.PI) * 0.4,
    ...over(i),
  }));
}

const ALERT_CLASSES = /bg-alert-|text-alert-|border-alert-|bg-sos/;

describe("reading Open-Meteo", () => {
  it("asks for all seven points in one request per model", () => {
    const url = new URL(marineUrl());
    expect(url.searchParams.get("latitude")!.split(",")).toHaveLength(COAST_POINTS.length);
    expect(url.searchParams.get("hourly")).toContain("wave_height");
  });

  it("joins the two models by the hour and keeps six hours behind to two days ahead", () => {
    const times = Array.from({ length: 96 }, (_, i) => NOW / 1000 - 24 * 3600 + i * 3600);
    const marine = COAST_POINTS.map(() => ({
      hourly: {
        time: times,
        wave_height: times.map(() => 0.5),
        wave_direction: times.map(() => 60),
        wave_period: times.map(() => 5),
        swell_wave_height: times.map(() => 0.3),
        sea_level_height_msl: times.map(() => 1),
      },
    }));
    const wind = COAST_POINTS.map(() => ({
      hourly: {
        time: times,
        wind_speed_10m: times.map(() => 18),
        wind_gusts_10m: times.map(() => 30),
        weather_code: times.map(() => 2),
      },
    }));
    const sea = toSea(marine, wind, NOW)!;
    expect(sea.points.map((p) => p.id)).toEqual(COAST_POINTS.map((p) => p.id));
    const first = sea.points[0]!;
    expect(first.hours[0]!.t).toBe(NOW - 6 * HOUR);
    expect(first.hours.at(-1)!.t).toBe(NOW + 48 * HOUR);
    expect(first.hours[0]).toMatchObject({ wave: 0.5, wind: 18, gust: 30, code: 2 });
  });

  it("says nothing rather than half an answer", () => {
    expect(toSea([], [], NOW)).toBeNull();
    expect(toSea({ error: true }, null, NOW)).toBeNull();
  });
});

describe("the note for fishermen", () => {
  it("is calm only on low waves and light wind", () => {
    expect(outlook({ hours: hours() }, NOW).grade).toBe("calm");
  });

  it("is rough from a metre of waves, a fresh breeze, strong gusts or thunder", () => {
    expect(outlook({ hours: hours((i) => (i === 20 ? { wave: 1.2 } : {})) }, NOW).grade).toBe(
      "rough",
    );
    expect(outlook({ hours: hours(() => ({ wind: 32 })) }, NOW).reasons).toEqual(["wind"]);
    expect(outlook({ hours: hours(() => ({ gust: 50 })) }, NOW).reasons).toEqual(["gusts"]);
    const storm = outlook({ hours: hours((i) => (i === 10 ? { code: 95 } : {})) }, NOW);
    expect(storm).toMatchObject({ grade: "rough", reasons: ["thunder"], thunder: true });
  });

  it("says small boats stay in from TMD's two metres, strong wind or hard gusts", () => {
    const big = outlook({ hours: hours((i) => (i === 18 ? { wave: 2.3 } : {})) }, NOW);
    expect(big.grade).toBe("stay");
    expect(big.waveMax).toBe(2.3);
    expect(big.waveMaxAt).toBe(NOW + 12 * HOUR);
    expect(SEA_LIMITS.stayWaveM).toBe(2);
    expect(outlook({ hours: hours(() => ({ wind: 45 })) }, NOW).grade).toBe("stay");
    expect(outlook({ hours: hours(() => ({ gust: 65 })) }, NOW).grade).toBe("stay");
  });

  it("looks only at the next day: a storm two days out does not close today", () => {
    const later = hours((i) => (i === 40 ? { wave: 3 } : {}));
    expect(outlook({ hours: later }, NOW).grade).toBe("calm");
  });

  it("is unknown, never calm, with too little data", () => {
    expect(outlook({ hours: [] }, NOW).grade).toBe("unknown");
    expect(outlook({ hours: hours(() => ({ wave: null })) }, NOW).grade).toBe("unknown");
    expect(outlook({ hours: hours(() => ({}), 14) }, NOW).grade).toBe("unknown");
    expect(coastGrade(null, NOW)).toBe("unknown");
  });

  it("never says the sea is safe, in any language", () => {
    for (const m of [th, ms, en]) {
      for (const g of ["stay", "rough", "calm", "unknown"] as const) {
        const words = `${m.sea.grade[g].title} ${m.sea.grade[g].short} ${m.sea.headline[g]}`;
        expect(words).not.toMatch(/safe|ปลอดภัย|selamat/i);
      }
      // The calm advice says the opposite: low waves are not a promise.
      expect(m.sea.advice.calm).toMatch(/not a promise|ไม่ได้รับประกัน|bukan jaminan/);
    }
    expect(en.sea.grade.stay.title).toBe("Small boats should stay in port");
    expect(th.sea.grade.stay.title).toBe("เรือเล็กควรงดออกจากฝั่ง");
  });
});

describe("wave heights in words", () => {
  it("are said to a tenth of a metre, one figure when both ends round alike", () => {
    expect(waveRange(0.12, 0.14)).toBe("0.1");
    expect(waveRange(0.4, 1.24)).toBe("0.4–1.2");
    expect(waveRange(null, null)).toBe("–");
  });
});

describe("the tide", () => {
  it("says whether the sea is rising and when it turns, without heights", () => {
    const view = tide({ hours: hours() }, NOW)!;
    expect(view.now).toBe("rising");
    expect(view.turns[0]!.kind).toBe("high");
    // A quarter period after the rise starts: about 3.1 hours from now, to ten minutes.
    expect(Math.abs(view.turns[0]!.t - (NOW + 3.1 * HOUR))).toBeLessThanOrEqual(20 * 60_000);
    expect(view.turns[1]!.kind).toBe("low");
    expect(Math.min(...view.curve.map((p) => p.y))).toBe(0);
    expect(Math.max(...view.curve.map((p) => p.y))).toBe(1);
  });

  it("draws nothing for a flat or missing sea level", () => {
    expect(tide({ hours: hours(() => ({ sea: 0.5 })) }, NOW)).toBeNull();
    expect(tide({ hours: hours(() => ({ sea: null })) }, NOW)).toBeNull();
  });
});

describe("the map's marks", () => {
  it("point where the waves travel, not where they come from", () => {
    expect(travelBearing(45)).toBe(225);
    expect(travelBearing(270)).toBe(90);
    expect(travelBearing(null)).toBe(0);
  });

  it("move more and faster the rougher the sea, and not at all without a forecast", () => {
    expect(SEA_LOOKS.stay.crests).toBeGreaterThan(SEA_LOOKS.rough.crests);
    expect(SEA_LOOKS.rough.crests).toBeGreaterThan(SEA_LOOKS.calm.crests);
    expect(SEA_LOOKS.stay.cycleMs).toBeLessThan(SEA_LOOKS.calm.cycleMs);
    expect(SEA_LOOKS.unknown.cycleMs).toBe(0);
  });

  it("open on the point off the person's own coast", () => {
    expect(nearestCoast({ lat: 6.42, lon: 101.82 })).toBe("narathiwat");
    expect(nearestCoast({ lat: 7.0, lon: 100.47 })).toBe("songkhla");
    expect(nearestCoast(null)).toBe("pattani");
    expect(isCoastId("takbai")).toBe(true);
    expect(isCoastId("bangkok")).toBe(false);
  });
});

function seaData(over: (id: string) => (i: number) => Partial<SeaHour>): SeaData {
  return {
    fetchedAt: new Date(NOW).toISOString(),
    points: COAST_POINTS.map((p) => ({ ...p, hours: hours(over(p.id)) })),
  };
}

describe("the section under the map", () => {
  it("opens on the roughest point and says small boats stay in, with the sea's numbers", () => {
    const data = seaData((id) => (i) => (id === "saiburi" && i === 15 ? { wave: 2.4 } : {}));
    const c = renderWithIntl(
      <SeaSection data={data} state="ok" now={NOW} pointId={null} onPoint={() => {}} />,
      "en",
    ).container;
    expect(c.querySelector("[data-sea-headline]")?.getAttribute("data-sea-headline")).toBe("stay");
    expect(c.querySelector("[data-sea-point='saiburi']")?.getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(c.querySelector("[data-sea-note]")?.textContent).toContain(en.sea.grade.stay.title);
    expect(c.querySelector("[data-sea-figures]")?.textContent).toContain("2.4");
    expect(c.querySelector("[data-sea-call='1199']")?.getAttribute("href")).toBe("tel:1199");
    expect(c.querySelector("[data-sea-call='1182']")).not.toBeNull();
    expect(c.querySelector("[data-sea-tmd]")?.getAttribute("href")).toContain("tmd.go.th");
    expect(c.textContent).toContain(en.sea.model);
    expect(c.textContent).toContain("Open-Meteo");
    expect(c.querySelector("[data-sea-chart='waves']")).not.toBeNull();
    expect(c.querySelector("[data-tide-now]")).not.toBeNull();
    // A model's sea is never dressed in the alert colours (safety rule 2).
    expect(c.innerHTML).not.toMatch(ALERT_CLASSES);
  });

  it("shows the point asked for, and hands a tap on another one back", () => {
    const picked: string[] = [];
    const c = renderWithIntl(
      <SeaSection
        data={seaData(() => () => ({}))}
        state="ok"
        now={NOW}
        pointId="takbai"
        onPoint={(id) => picked.push(id)}
      />,
    ).container;
    expect(c.querySelector("[data-sea-note]")?.textContent).toContain(th.sea.points.takbai);
    expect(c.querySelector("[data-sea-note]")?.getAttribute("data-sea-note")).toBe("calm");
    c.querySelector<HTMLButtonElement>("[data-sea-point='chana']")!.click();
    expect(picked).toEqual(["chana"]);
  });

  it("says so when there is no forecast, and still gives the numbers to call", () => {
    const c = renderWithIntl(
      <SeaSection data={null} state="unavailable" now={NOW} pointId={null} onPoint={() => {}} />,
    ).container;
    expect(c.querySelector("[data-sea-failed]")?.textContent).toBe(th.sea.failed);
    expect(c.querySelector("[data-sea-call='1199']")).not.toBeNull();
  });

  it("reaches the map page with its words and the credit Open-Meteo asks for", () => {
    const sent = mapMessages(en) as Record<string, unknown>;
    expect(sent.sea).toBeDefined();
    expect(sent.attribution).toBeDefined();
    expect(en.mapMethod.sea.lead).toBeTruthy();
    expect(en.mapMethod.credits).toContain("Open-Meteo");
  });
});
