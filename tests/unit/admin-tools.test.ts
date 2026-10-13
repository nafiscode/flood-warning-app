import { describe, expect, it } from "vitest";
import {
  EXPORTS,
  exportDays,
  exportFileName,
  exportKind,
  toCsv,
  toGeoJson,
} from "@/lib/export-format";
import en from "@/messages/en.json";
import ms from "@/messages/ms.json";
import th from "@/messages/th.json";

describe("a CSV export", () => {
  it("has a header, quotes what needs quoting, and opens as UTF-8 in a spreadsheet", () => {
    const csv = toCsv(
      [{ tambon: "950101", reason: 'ฝน "หนัก", ต่อเนื่อง', n: 3, when: null }],
      ["tambon", "reason", "n", "when"],
    );
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1)).toBe('tambon,reason,n,when\r\n950101,"ฝน ""หนัก"", ต่อเนื่อง",3,\r\n');
  });

  it("never lets a cell be run as a formula", () => {
    const csv = toCsv([{ a: "=HYPERLINK(1)", b: "+66", c: -4, d: "@x" }], ["a", "b", "c", "d"]);
    expect(csv).toContain("'=HYPERLINK(1),'+66,-4,'@x");
  });

  it("writes lists and dates plainly", () => {
    const csv = toCsv(
      [{ tambons: ["950101", "950102"], at: new Date("2026-11-20T01:00:00Z") }],
      ["tambons", "at"],
    );
    expect(csv).toContain("950101 950102,2026-11-20T01:00:00.000Z");
  });
});

describe("a GeoJSON export", () => {
  it("puts longitude first, keeps the position out of the properties, and skips rows with none", () => {
    const out = JSON.parse(
      toGeoJson(
        [
          { tambon: "950101", lat: 6.54, lon: 101.28, status: "received" },
          { tambon: "950102", lat: null, lon: null, status: "received" },
        ],
        ["tambon", "lat", "lon", "status"],
      ),
    );
    expect(out.type).toBe("FeatureCollection");
    expect(out.features).toHaveLength(1);
    expect(out.features[0].geometry).toEqual({ type: "Point", coordinates: [101.28, 6.54] });
    expect(out.features[0].properties).toEqual({ tambon: "950101", status: "received" });
  });

  it("uses an alert's own outline when the row carries one", () => {
    const outline = { type: "MultiPolygon", coordinates: [] };
    const out = JSON.parse(
      toGeoJson([{ alert_id: "a", geometry: outline }], ["alert_id", "geometry"]),
    );
    expect(out.features[0].geometry).toEqual(outline);
    expect(out.features[0].properties).toEqual({ alert_id: "a" });
  });
});

describe("what an export may be asked for", () => {
  it("knows three kinds and four periods, and falls back safely", () => {
    expect(exportKind("sos")).toBe("sos");
    expect(exportKind("profiles")).toBeNull();
    expect(exportDays("90")).toBe(90);
    expect(exportDays("100000")).toBe(30);
  });

  it("names the file after what is in it", () => {
    expect(exportFileName("sos", "csv", 30, true, "2026-11-20")).toBe(
      "jaga-sos-anonymized-30d-2026-11-20.csv",
    );
    expect(exportFileName("sos", "geojson", 7, false, "2026-11-20")).toBe(
      "jaga-sos-full-7d-2026-11-20.geojson",
    );
    expect(exportFileName("alerts", "csv", 90, true, "2026-11-20")).toBe(
      "jaga-alerts-90d-2026-11-20.csv",
    );
  });

  it("has no column for anything personal", () => {
    const all = Object.values(EXPORTS).flatMap((e) => [...e.columns]);
    expect(all.filter((c) => /phone|name|requester|reporter|device|text|voice/.test(c))).toEqual(
      [],
    );
  });
});

describe("the admin tools' words", () => {
  const keys = (o: unknown, at = ""): string[] =>
    o && typeof o === "object"
      ? Object.entries(o).flatMap(([k, v]) => keys(v, at ? `${at}.${k}` : k))
      : [at];

  it("exist in all three languages, key for key", () => {
    expect(keys(ms.adminTools)).toEqual(keys(th.adminTools));
    expect(keys(en.adminTools)).toEqual(keys(th.adminTools));
    expect(keys(ms.admin.nav)).toEqual(keys(th.admin.nav));
    expect(keys(en.admin.nav)).toEqual(keys(th.admin.nav));
  });
});
