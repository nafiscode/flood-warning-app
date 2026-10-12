/**
 * Finding a place by name, and following a shared map link (the owner's request, 12 Oct). The
 * route is these functions plus a network; here they are held to what matters: the right tambon
 * comes first, a common word does not flood the list, and the server can be sent to Google's
 * map hosts and nowhere else.
 */
import { describe, expect, it } from "vitest";
import { resolveMapLink, type Fetcher } from "@/lib/map-link";
import { decodePlusCode } from "@/lib/place-input";
import {
  fromNominatim,
  mergePlaces,
  nominatimUrl,
  placeFromShortCode,
  plainName,
  preferNearby,
  referenceFor,
  searchDirectory,
  SERVICE_MIDDLE,
  type DirectoryRow,
} from "@/lib/place-search";

const row = (
  code: string,
  nameTh: string,
  nameEn: string,
  districtTh: string,
  districtEn: string,
  lat: number,
  lon: number,
  provinceTh = "ปัตตานี",
  provinceEn = "Pattani",
): DirectoryRow => ({
  code,
  nameTh,
  nameEn,
  districtTh,
  districtEn,
  provinceTh,
  provinceEn,
  lat,
  lon,
});

const ROWS: DirectoryRow[] = [
  row("940101", "สะบารัง", "Sabarang", "เมืองปัตตานี", "Mueang Pattani", 6.868, 101.25),
  row("940104", "บานา", "Bana", "เมืองปัตตานี", "Mueang Pattani", 6.878, 101.272),
  row("940901", "ยะรัง", "Yarang", "ยะรัง", "Yarang", 6.76, 101.3),
  row("940902", "สะดาวา", "Sadawa", "ยะรัง", "Yarang", 6.73, 101.32),
  row("941001", "บ้านกลาง", "Ban Klang", "ปะนาเระ", "Panare", 6.86, 101.5),
  row("950101", "สะเตง", "Sateng", "เมืองยะลา", "Mueang Yala", 6.54, 101.28, "ยะลา", "Yala"),
];

describe("Jaga's own tambons", () => {
  it("the name finds it, however it is written", () => {
    for (const text of [
      "บานา",
      "ต.บานา",
      "ตำบลบานา",
      "ต.บานา อ.เมืองปัตตานี",
      "bana",
      "Tambon Bana",
    ]) {
      expect(searchDirectory(text, ROWS, "th")[0]).toMatchObject({ name: "ต.บานา" });
    }
  });

  it("is named the way the rest of the app names a place", () => {
    expect(searchDirectory("บานา", ROWS, "th")[0]).toEqual({
      name: "ต.บานา",
      detail: "อ.เมืองปัตตานี จ.ปัตตานี",
      lat: 6.878,
      lon: 101.272,
      source: "tambon",
    });
    expect(searchDirectory("bana", ROWS, "en")[0]).toMatchObject({
      name: "Bana",
      detail: "Mueang Pattani, Pattani",
    });
  });

  it("Thai typed without spaces still names it", () => {
    expect(searchDirectory("โรงเรียนบ้านบานา", ROWS, "th")[0]).toMatchObject({ name: "ต.บานา" });
  });

  it("a common word does not bring up every tambon that begins with it", () => {
    const found = searchDirectory("บ้าน บานา", ROWS, "th");
    expect(found.map((place) => place.name)).toEqual(["ต.บานา"]);
  });

  it("a district alone gives some of its tambons, so the map lands in the right part", () => {
    const found = searchDirectory("อ.ปะนาเระ", ROWS, "th");
    expect(found.map((place) => place.name)).toEqual(["ต.บ้านกลาง"]);
  });

  it("the same name as tambon and district: the tambon itself first", () => {
    expect(searchDirectory("ยะรัง", ROWS, "th")[0]).toMatchObject({ name: "ต.ยะรัง" });
  });

  it("nothing for a name it does not know, and nothing for one letter", () => {
    expect(searchDirectory("กรุงเทพ", ROWS, "th")).toEqual([]);
    expect(searchDirectory("ก", ROWS, "th")).toEqual([]);
  });

  it("the words for 'subdistrict of' are not part of a name", () => {
    expect(plainName("ต.บานา อ.เมืองปัตตานี จ.ปัตตานี")).toBe("บานา เมืองปัตตานี ปัตตานี");
    expect(plainName("Tambon Bana, Pattani Province")).toBe("bana pattani");
  });
});

describe("a short plus code and the town it names", () => {
  it("takes the town from the words after the code", () => {
    expect(referenceFor("เมืองยะลา ยะลา", ROWS)).toEqual({ lat: 6.54, lon: 101.28 });
    expect(referenceFor("Bana, Pattani", ROWS)).toEqual({ lat: 6.878, lon: 101.272 });
    expect(referenceFor("", ROWS)).toBeNull();
    expect(referenceFor("Kuala Lumpur", ROWS)).toBeNull();
  });

  it("completes the code from that town, the map, or the service area, in that order", () => {
    const withTown = placeFromShortCode("V7HC+7Q", "Bana, Pattani", ROWS, null)!;
    expect(withTown).toMatchObject({ name: "V7HC+7Q", source: "code" });
    expect(Math.abs(withTown.lat - 6.878)).toBeLessThan(0.5);
    expect(Math.abs(withTown.lon - 101.272)).toBeLessThan(0.5);

    // No town named: the middle of the map decides which square is meant.
    const far = placeFromShortCode("V7HC+7Q", "", ROWS, { lat: 13.75, lon: 100.5 })!;
    expect(Math.abs(far.lat - 13.75)).toBeLessThan(0.5);

    const nothing = placeFromShortCode("V7HC+7Q", "", ROWS, null)!;
    expect(Math.abs(nothing.lat - SERVICE_MIDDLE.lat)).toBeLessThan(0.5);
    // The same last characters in all three: they are the same code, in different squares.
    expect((withTown.lat * 8000) % 1).toBeCloseTo((nothing.lat * 8000) % 1, 3);
  });

  it("agrees with the full code for the same square", () => {
    const full = decodePlusCode("6PV7V7HC+7Q")!;
    const short = placeFromShortCode("V7HC+7Q", "", ROWS, { lat: full.lat, lon: full.lon })!;
    expect(short.lat).toBeCloseTo(full.lat, 5);
    expect(short.lon).toBeCloseTo(full.lon, 5);
  });
});

describe("landmarks from OpenStreetMap", () => {
  it("asks with the four provinces as a preference, not a fence", () => {
    const url = new URL(nominatimUrl("มัสยิดกรือเซะ", "th"));
    expect(url.hostname).toBe("nominatim.openstreetmap.org");
    expect(url.searchParams.get("q")).toBe("มัสยิดกรือเซะ");
    expect(url.searchParams.get("bounded")).toBe("0");
    expect(url.searchParams.get("viewbox")).toBeTruthy();
    expect(url.searchParams.get("accept-language")).toMatch(/^th/);
  });

  it("gives a name and what narrows it down, without the postcode", () => {
    const found = fromNominatim([
      {
        name: "มัสยิดกรือเซะ",
        display_name:
          "มัสยิดกรือเซะ, ทางหลวงแผ่นดินหมายเลข 42, ตันหยงลุโละ, ปัตตานี, 94000, ประเทศไทย",
        lat: "6.8741",
        lon: "101.3024",
      },
    ]);
    expect(found).toEqual([
      {
        name: "มัสยิดกรือเซะ",
        detail: "ทางหลวงแผ่นดินหมายเลข 42, ตันหยงลุโละ, ปัตตานี, ประเทศไทย",
        lat: 6.8741,
        lon: 101.3024,
        source: "landmark",
      },
    ]);
  });

  it("leaves out anything it could not put on a map, and survives a bad answer", () => {
    expect(fromNominatim([{ display_name: "x", lat: "north", lon: "1" }])).toEqual([]);
    expect(fromNominatim([{ lat: "6.8", lon: "101.2" }])).toEqual([]);
    expect(fromNominatim({ error: "busy" })).toEqual([]);
    expect(fromNominatim(null)).toEqual([]);
  });

  it("an answer from the far side of the world is dropped when something nearer was found", () => {
    const place = (name: string, lat: number, lon: number) => ({
      name,
      detail: "",
      lat,
      lon,
      source: "landmark" as const,
    });
    const xinjiang = place("Altan Salaa", 44.4, 84.7);
    const kelantan = place("Kota Bharu", 6.13, 102.24);
    // A real answer the first browser try gave for "ต.สะเตง".
    expect(preferNearby([xinjiang], true)).toEqual([]);
    expect(preferNearby([xinjiang, kelantan], false)).toEqual([kelantan]);
    // Nothing nearer anywhere: it is all there is, and the person can still judge it.
    expect(preferNearby([xinjiang], false)).toEqual([xinjiang]);
  });

  it("the same place from two sources is listed once, and the list stays short", () => {
    const a = { name: "A", detail: "", lat: 6.8, lon: 101.2, source: "tambon" as const };
    const twin = { ...a, lat: 6.8001, source: "landmark" as const };
    const many = Array.from({ length: 12 }, (_, i) => ({ ...a, name: `P${i}`, lat: 6 + i }));
    expect(mergePlaces([a], [twin])).toEqual([a]);
    expect(mergePlaces(many)).toHaveLength(8);
  });
});

describe("following a shared link, and only to Google's maps", () => {
  const HOME = "https://www.google.com/maps/place/Home/@6.9,101.3,15z/data=!3d6.87821!4d101.27191";
  /** A pretend network: each address answers with a redirect, a page, or an error. */
  const network = (map: Record<string, { to?: string; page?: string; status?: number }>) => {
    const asked: string[] = [];
    const fetcher: Fetcher = async (url) => {
      asked.push(url);
      const hit = map[url] ?? { status: 404 };
      return {
        status: hit.status ?? (hit.to ? 302 : 200),
        location: hit.to ?? null,
        text: async () => hit.page ?? "",
      };
    };
    return { fetcher, asked };
  };

  it("a short link is followed to the place it was shared from", async () => {
    const { fetcher, asked } = network({ "https://maps.app.goo.gl/AbCd": { to: HOME } });
    expect(await resolveMapLink("https://maps.app.goo.gl/AbCd", fetcher)).toEqual({
      lat: 6.87821,
      lon: 101.27191,
    });
    // One request: the answer was in the address it was sent on to.
    expect(asked).toEqual(["https://maps.app.goo.gl/AbCd"]);
  });

  it("a consent page in the way is stepped through", async () => {
    const consent = `https://consent.google.com/m?continue=${encodeURIComponent(HOME)}&gl=TH`;
    const { fetcher } = network({ "https://maps.app.goo.gl/AbCd": { to: consent } });
    expect(await resolveMapLink("https://maps.app.goo.gl/AbCd", fetcher)).toMatchObject({
      lat: 6.87821,
    });
  });

  it("when the last address has no position, the page is read for one", async () => {
    const last = "https://www.google.com/maps?q=Home&ftid=0x1";
    const { fetcher } = network({
      "https://maps.app.goo.gl/AbCd": { to: last },
      [last]: { page: `<a href="https://www.google.com/maps/@6.87821,101.27191,17z">x</a>` },
    });
    expect(await resolveMapLink("https://maps.app.goo.gl/AbCd", fetcher)).toEqual({
      lat: 6.87821,
      lon: 101.27191,
    });
  });

  it("never leaves Google's map hosts, whatever the link or the redirect says", async () => {
    for (const start of [
      "https://example.com/x",
      "http://maps.app.goo.gl/AbCd",
      "https://169.254.169.254/latest/meta-data",
      "https://localhost/admin",
      "https://maps.app.goo.gl.evil.example/AbCd",
      "https://user:pass@maps.app.goo.gl/AbCd",
      "https://maps.app.goo.gl:8443/AbCd",
      "file:///etc/passwd",
      "not a link",
    ]) {
      const { fetcher, asked } = network({});
      expect(await resolveMapLink(start, fetcher)).toBeNull();
      expect(asked).toEqual([]);
    }
    // A real short link that redirects somewhere else is dropped at the hop, not followed.
    const { fetcher, asked } = network({
      "https://maps.app.goo.gl/AbCd": { to: "https://internal.example/secret" },
    });
    expect(await resolveMapLink("https://maps.app.goo.gl/AbCd", fetcher)).toBeNull();
    expect(asked).toEqual(["https://maps.app.goo.gl/AbCd"]);
  });

  it("gives up after a few hops instead of going round for ever", async () => {
    const { fetcher, asked } = network({
      "https://maps.app.goo.gl/a": { to: "https://maps.app.goo.gl/b" },
      "https://maps.app.goo.gl/b": { to: "https://maps.app.goo.gl/a" },
    });
    expect(await resolveMapLink("https://maps.app.goo.gl/a", fetcher)).toBeNull();
    expect(asked.length).toBeLessThanOrEqual(5);
  });

  it("a link that leads nowhere readable is 'could not tell', not a guess", async () => {
    const { fetcher } = network({ "https://maps.app.goo.gl/AbCd": { status: 404 } });
    expect(await resolveMapLink("https://maps.app.goo.gl/AbCd", fetcher)).toBeNull();
  });
});
