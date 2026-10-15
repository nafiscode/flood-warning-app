import { describe, expect, it } from "vitest";
import {
  isPublicData,
  mapAsset,
  offlinePageFor,
  WARM_EVERY_MS,
  warmDue,
  warmUrls,
} from "@/lib/offline-warm";

describe("offline warm-up (A9, safety rule 7)", () => {
  it("keeps home, SOS, food and water and the map ready in the person's language", () => {
    expect(warmUrls("th")).toEqual(["/", "/sos", "/supplies", "/map", "/api/geo/areas"]);
    expect(warmUrls("ms")).toEqual(["/ms", "/ms/sos", "/ms/supplies", "/ms/map", "/api/geo/areas"]);
    expect(warmUrls("en")[0]).toBe("/en");
  });

  it("never warms a page that needs an account", () => {
    for (const l of ["th", "ms", "en"] as const) {
      for (const u of warmUrls(l)) expect(u).not.toMatch(/report|account|admin|authority|sign-in/);
    }
  });

  it("runs once a day, and again if the phone's clock went back", () => {
    const now = 1_800_000_000_000;
    expect(warmDue(null, now)).toBe(true);
    expect(warmDue(now - 1000, now)).toBe(false);
    expect(warmDue(now - WARM_EVERY_MS, now)).toBe(true);
    expect(warmDue(now + 60_000, now)).toBe(true);
  });

  it("keeps only public, same-for-everyone answers", () => {
    expect(isPublicData("/api/geo/areas")).toBe(true);
    expect(isPublicData("/api/public/map")).toBe(true);
    expect(isPublicData("/api/geo/tambons")).toBe(true);
    for (const p of [
      "/api/me/places",
      "/api/sos",
      "/api/public/status",
      "/api/report/mine",
      "/api/geo/locate",
    ]) {
      expect(isPublicData(p)).toBe(false);
    }
  });

  it("keeps OpenFreeMap, EOX and terrain tiles as viewed, never Esri's", () => {
    const u = (s: string) => new URL(s);
    expect(
      mapAsset(u("https://tiles.openfreemap.org/planet/20251001_001001_pt/12/3270/1950.pbf")),
    ).toBe("tile");
    expect(
      mapAsset(u("https://tiles.openfreemap.org/fonts/Noto%20Sans%20Regular/3584-3839.pbf")),
    ).toBe("tile");
    expect(mapAsset(u("https://tiles.openfreemap.org/styles/positron"))).toBe("style");
    expect(mapAsset(u("https://tiles.openfreemap.org/planet"))).toBe("style");
    expect(
      mapAsset(
        u("https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/12/1950/3270.jpg"),
      ),
    ).toBe("tile");
    expect(
      mapAsset(u("https://elevation-tiles-prod.s3.amazonaws.com/terrarium/10/800/490.png")),
    ).toBe("tile");
    expect(
      mapAsset(
        u(
          "https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/12/1950/3270",
        ),
      ),
    ).toBeNull();
    expect(
      mapAsset(
        u(
          "https://basemapstyles-api.arcgis.com/arcgis/rest/services/styles/v2/styles/arcgis/terrain",
        ),
      ),
    ).toBeNull();
  });

  it("shows the offline page in the language of the page that failed", () => {
    expect(offlinePageFor("/sos")).toBe("/offline");
    expect(offlinePageFor("/ms/sos")).toBe("/ms/offline");
    expect(offlinePageFor("/en")).toBe("/en/offline");
    expect(offlinePageFor("/msx")).toBe("/offline");
  });
});
