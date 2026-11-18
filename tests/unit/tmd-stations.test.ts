import { describe, expect, it } from "vitest";
import {
  distanceKm,
  isFresh,
  MAX_KM,
  nearestStations,
  parseStations,
  PROVINCES_TH,
  STALE_MS,
  stationName,
  stationsUrl,
  toIso,
  toNumber,
  type TmdStation,
} from "@/lib/tmd-stations";

/**
 * Reading TMD's station feed.
 *
 * The sample is the real feed of 18 November 2026, trimmed to four stations: three of ours and one
 * from outside the service area, which must be dropped. TMD writes this feed's timestamps month
 * first - a different format from the warning feed - and that is the thing most likely to go wrong
 * silently, so it has its own tests.
 */

const station = (
  name: string,
  province: string,
  lat: number,
  lon: number,
  rain: string,
  when = "11/18/2026 22:00:00",
) => `<Station><WmoStationNumber>4${name.length}${Math.round(lat * 10)}</WmoStationNumber>
<StationNameThai>${name}</StationNameThai><StationNameEnglish>${name.toUpperCase()} AIRPORT</StationNameEnglish>
<Province>${province}</Province><Latitude Unit="decimal degree">${lat}</Latitude>
<Longitude Unit="decimal degree">${lon}</Longitude>
<Observation><DateTime>${when}</DateTime>
<AirTemperature Unit="celsius">25.2</AirTemperature><RelativeHumidity Unit="%">95</RelativeHumidity>
<Rainfall Unit="mm">0.00</Rainfall><Rainfall24Hr Unit="mm">${rain}</Rainfall24Hr>
</Observation></Station>`;

const FEED = `<?xml version="1.0"?><Weather3Hours Version="2.0"><Header><Title>Weather3Hours</Title>
</Header><Stations>
${station("pattani", "ปัตตานี", 6.78333, 101.15, "11.20")}
${station("songkhla", "สงขลา", 7.18211, 100.60769, "22.60")}
${station("narathiwat", "นราธิวาส", 6.41667, 101.81667, "0.00")}
${station("chiangmai", "เชียงใหม่", 18.78, 98.98, "0.00")}
</Stations></Weather3Hours>`;

/** 2026-11-18 22:10 Bangkok, ten minutes after the observations above. */
const NOW = Date.parse("2026-11-18T15:10:00Z");

/** Pattani town. */
const PATTANI = { lat: 6.87, lon: 101.25 };

describe("TMD's station timestamps", () => {
  it("reads them month first, in Bangkok time", () => {
    // 22:00 in Bangkok is 15:00 UTC. Reading this as 11 June rather than 18 November would put a
    // live reading five months in the past and hide it as stale.
    expect(toIso("11/18/2026 22:00:00")).toBe("2026-11-18T15:00:00.000Z");
    expect(toIso("6/5/2026 7:00:00")).toBe("2026-06-05T00:00:00.000Z");
  });

  it("accepts a missing seconds field", () => {
    expect(toIso("11/18/2026 22:00")).toBe("2026-11-18T15:00:00.000Z");
  });

  it("is null for anything else", () => {
    expect(toIso(null)).toBeNull();
    expect(toIso("2026-11-18 22:00:00")).toBeNull();
    expect(toIso("18 Nov 2026")).toBeNull();
  });
});

describe("the numbers", () => {
  it("reads a decimal and keeps a zero", () => {
    expect(toNumber("22.60")).toBe(22.6);
    // 0 mm is a measurement, not a missing value: it must never become null or "no data".
    expect(toNumber("0.00")).toBe(0);
  });

  it("is null, never NaN, for anything unreadable", () => {
    for (const bad of [null, "", "-", "n/a", "มม."]) expect(toNumber(bad)).toBeNull();
  });
});

describe("parsing the feed", () => {
  it("keeps the four provinces' stations and drops the rest", () => {
    const stations = parseStations(FEED);
    expect(stations.map((s) => s.nameTh)).toEqual(["pattani", "songkhla", "narathiwat"]);
    expect(stations.every((s) => (PROVINCES_TH as readonly string[]).includes(s.provinceTh))).toBe(
      true,
    );
  });

  it("reads the figure, the hour and the position", () => {
    const [pattani] = parseStations(FEED);
    expect(pattani!.rain24hMm).toBe(11.2);
    expect(pattani!.observedAt).toBe("2026-11-18T15:00:00.000Z");
    expect(pattani!.lat).toBeCloseTo(6.78333, 5);
    expect(pattani!.tempC).toBe(25.2);
    expect(pattani!.humidity).toBe(95);
  });

  it("skips a station with no position or no name", () => {
    const broken = `<Station><Province>ปัตตานี</Province><StationNameThai>x</StationNameThai></Station>`;
    expect(parseStations(broken)).toHaveLength(0);
  });

  it("returns nothing for junk instead of throwing", () => {
    for (const junk of ["", "not xml", "<html>503</html>", "<Station>"]) {
      expect(() => parseStations(junk)).not.toThrow();
      expect(parseStations(junk)).toHaveLength(0);
    }
  });
});

describe("how far away the station is", () => {
  it("measures a known distance", () => {
    // Pattani town to Narathiwat station is about 90 km; to its own station about 12 km.
    const stations = parseStations(FEED);
    expect(distanceKm(PATTANI, stations[0]!)).toBeLessThan(15);
    expect(distanceKm(PATTANI, stations[2]!)).toBeGreaterThan(70);
    expect(distanceKm(PATTANI, stations[2]!)).toBeLessThan(110);
  });

  it("is zero for the same point and symmetrical", () => {
    expect(distanceKm(PATTANI, PATTANI)).toBe(0);
    const other = { lat: 7.0, lon: 100.5 };
    expect(distanceKm(PATTANI, other)).toBeCloseTo(distanceKm(other, PATTANI), 9);
  });
});

describe("is the reading recent enough to show", () => {
  const fresh = (): TmdStation => parseStations(FEED)[0]!;

  it("keeps a reading from this round", () => {
    expect(isFresh(fresh(), NOW)).toBe(true);
  });

  it("drops one that has missed several rounds", () => {
    expect(isFresh(fresh(), NOW + STALE_MS)).toBe(false);
  });

  it("drops one with no hour at all, and one dated in the future", () => {
    expect(isFresh({ ...fresh(), observedAt: null }, NOW)).toBe(false);
    // A feed that reports tomorrow is broken; showing it as "measured" would be a lie.
    expect(isFresh(fresh(), NOW - 48 * 60 * 60_000)).toBe(false);
  });
});

describe("which stations a reader sees", () => {
  it("is the nearest ones, each with its distance, nearest first", () => {
    const shown = nearestStations(parseStations(FEED), PATTANI, NOW);
    // Narathiwat's station is about 90 km from Pattani town - a different catchment, and past the
    // limit, so it is not offered as a check on Pattani's rain.
    expect(shown.map((s) => s.nameTh)).toEqual(["pattani", "songkhla"]);
    expect(shown[0]!.distanceKm).toBeLessThan(shown[1]!.distanceKm!);
    expect(shown[0]!.distanceKm).toBeDefined();
  });

  it("holds to the limit", () => {
    expect(nearestStations(parseStations(FEED), PATTANI, NOW, 2)).toHaveLength(2);
  });

  it("still lists stations when nobody has chosen a place", () => {
    const shown = nearestStations(parseStations(FEED), null, NOW);
    expect(shown).toHaveLength(3);
    // No place, so no distance may be claimed.
    expect(shown.every((s) => s.distanceKm === undefined)).toBe(true);
  });

  it("says nothing rather than offering a station too far to mean anything", () => {
    // Checked against the live feed on 19 Nov 2026: one round carried all seven of our stations
    // and the next carried two, both in Songkhla. For a reader in Narathiwat that is a reading
    // from 190 km away, which would look like their own rain and is not.
    const faraway = { lat: 6.42, lon: 101.82 };
    const songkhlaOnly = parseStations(FEED).filter((s) => s.provinceTh === "สงขลา");
    const shown = nearestStations(songkhlaOnly, faraway, NOW);
    expect(shown).toEqual([]);
    // The same stations are shown to somebody who is actually near them.
    expect(nearestStations(songkhlaOnly, { lat: 7.0, lon: 100.5 }, NOW).length).toBeGreaterThan(0);
  });

  it("keeps a station just inside the limit and drops one just outside", () => {
    const here = { lat: 6.78333, lon: 101.15 };
    const near = parseStations(FEED)[0]!;
    const inside = nearestStations([near], here, NOW);
    expect(inside).toHaveLength(1);
    expect(inside[0]!.distanceKm).toBeLessThan(MAX_KM);
  });

  it("shows nothing at all when every station is stale", () => {
    expect(nearestStations(parseStations(FEED), PATTANI, NOW + STALE_MS)).toEqual([]);
  });
});

describe("the station's name", () => {
  it("is TMD's Thai name in Thai", () => {
    expect(stationName(parseStations(FEED)[0]!, "th")).toBe("pattani");
  });

  it("is set in title case elsewhere, because TMD writes English in capitals", () => {
    expect(stationName(parseStations(FEED)[0]!, "en")).toBe("Pattani Airport");
  });

  it("falls back to the Thai name when TMD gave no English one", () => {
    const station = { ...parseStations(FEED)[0]!, nameEn: null };
    expect(stationName(station, "en")).toBe("pattani");
  });
});

describe("the feed's address", () => {
  it("is TMD's 3-hourly observations with the public credentials", () => {
    const url = new URL(stationsUrl());
    expect(url.origin + url.pathname).toBe("https://data.tmd.go.th/api/Weather3Hours/V2/");
    expect(url.searchParams.get("uid")).toBeTruthy();
  });
});
