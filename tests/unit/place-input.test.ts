/**
 * The "find the place" box (the owner's request, 12 Oct): whatever a person pastes is understood.
 * Every shape below is one somebody really has in their hand: a share link, numbers copied from a
 * map app, the code Google Maps shows for a house with no address, or just a name.
 */
import { describe, expect, it } from "vitest";
import {
  coordinatesFromUrl,
  decodePlusCode,
  isMapLinkHost,
  parseCoordinates,
  readPlaceInput,
  recoverPlusCode,
} from "@/lib/place-input";

// A house in Bana, Pattani.
const BANA = { lat: 6.87821, lon: 101.27191 };
const near = (point: { lat: number; lon: number } | null, lat: number, lon: number, by = 4) => {
  expect(point).not.toBeNull();
  expect(point!.lat).toBeCloseTo(lat, by);
  expect(point!.lon).toBeCloseTo(lon, by);
};

describe("coordinates as text", () => {
  it.each([
    ["6.87821, 101.27191"],
    ["6.87821,101.27191"],
    ["6.87821 101.27191"],
    ["(6.87821, 101.27191)"],
    ["6.87821°, 101.27191°"],
    ["6.87821° N, 101.27191° E"],
    ["6.87821N 101.27191E"],
    ["lat 6.87821 lon 101.27191"],
    ["Latitude: 6.87821, Longitude: 101.27191"],
    ["ละติจูด 6.87821 ลองจิจูด 101.27191"],
    ["พิกัด 6.87821, 101.27191"],
    ["  6.87821 ,   101.27191  "],
    ["๖.๘๗๘๒๑, ๑๐๑.๒๗๑๙๑"],
  ])("%s", (text) => near(parseCoordinates(text), BANA.lat, BANA.lon));

  it("the other way round is still understood: no latitude is 101", () => {
    near(parseCoordinates("101.27191, 6.87821"), BANA.lat, BANA.lon);
    near(parseCoordinates("101.27191 E, 6.87821 N"), BANA.lat, BANA.lon);
  });

  it("degrees, minutes and seconds, as Google Maps copies them", () => {
    near(parseCoordinates(`6°52'41.6"N 101°16'18.9"E`), 6.87822, 101.27192, 3);
    near(parseCoordinates("6°52′41.6″N 101°16′18.9″E"), 6.87822, 101.27192, 3);
    near(parseCoordinates("6°52.693'N, 101°16.315'E"), 6.87822, 101.27192, 3);
    near(parseCoordinates(`101°16'18.9"E 6°52'41.6"N`), 6.87822, 101.27192, 3);
  });

  it("south and west are negative", () => {
    near(parseCoordinates("33.8688 S, 151.2093 E"), -33.8688, 151.2093);
    near(parseCoordinates(`33°52'07.7"S 151°12'33.5"E`), -33.8688, 151.2093, 3);
  });

  it("is not fooled by text that only has numbers in it", () => {
    for (const text of [
      "บ้านเลขที่ 12 หมู่ 3",
      "12 3",
      "6, 101",
      "ถนนสาย 42 กม. 15.5",
      "081-234-5678",
      "95.5 120.2",
      "0.0, 0.0",
      "",
    ]) {
      expect(parseCoordinates(text)).toBeNull();
    }
  });
});

describe("a position inside a link", () => {
  it.each([
    ["https://www.google.com/maps?q=6.87821,101.27191"],
    ["https://maps.google.com/?q=6.87821,101.27191"],
    ["https://maps.google.com/maps?q=loc:6.87821,101.27191"],
    ["https://www.google.com/maps/search/?api=1&query=6.87821%2C101.27191"],
    ["https://www.google.com/maps/place/6.87821,101.27191"],
    ["https://www.google.com/maps/@6.87821,101.27191,17z"],
    ["https://www.google.com/maps/dir/?api=1&destination=6.87821,101.27191"],
    ["https://maps.apple.com/?ll=6.87821,101.27191&q=Home"],
    ["https://www.openstreetmap.org/?mlat=6.87821&mlon=101.27191#map=16/6.9/101.3"],
    ["https://www.openstreetmap.org/#map=16/6.87821/101.27191"],
    ["geo:6.87821,101.27191"],
    ["geo:6.87821,101.27191?z=17"],
  ])("%s", (url) => near(coordinatesFromUrl(url), BANA.lat, BANA.lon));

  it("the place wins over where the screen happened to be centred", () => {
    const url =
      "https://www.google.com/maps/place/Bana/@6.9000000,101.3000000,15z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d6.87821!4d101.27191!16s";
    near(coordinatesFromUrl(url), BANA.lat, BANA.lon);
  });

  it("a link with no position in it gives nothing, rather than a guess", () => {
    expect(coordinatesFromUrl("https://www.google.com/maps/place/Pattani")).toBeNull();
    expect(coordinatesFromUrl("https://maps.app.goo.gl/AbCdEf123")).toBeNull();
    expect(coordinatesFromUrl("not a link")).toBeNull();
  });
});

describe("the short code Google Maps gives a house with no address", () => {
  it("a full code is read on the spot", () => {
    // Google's own example: the Googleplex.
    near(decodePlusCode("849VCWC8+R9"), 37.4220625, -122.0840625, 5);
    expect(decodePlusCode("849VCWC8+R")).toBeNull();
    expect(decodePlusCode("AAAAAAAA+AA")).toBeNull();
  });

  it("a short one is completed from a place nearby", () => {
    const full = decodePlusCode("849VCWC8+R9")!;
    near(recoverPlusCode("CWC8+R9", { lat: 37.4, lon: -122.1 }), full.lat, full.lon, 5);
    // The nearest matching square, even from the far side of a boundary.
    near(recoverPlusCode("CWC8+R9", { lat: 37.6, lon: -121.9 }), full.lat, full.lon, 5);
    // Six characters before the plus: only the first two were left off.
    near(recoverPlusCode("9VCWC8+R9", { lat: 35, lon: -118 }), full.lat, full.lon, 5);
    expect(recoverPlusCode("849VCWC8+R9", { lat: 0, lon: 0 })).toBeNull();
  });

  it("round trip in the service area", () => {
    // Any point: take its full code's meaning and get it back from the short form.
    const point = recoverPlusCode("V7HC+7Q", { lat: 6.87, lon: 101.25 })!;
    expect(Math.abs(point.lat - 6.87)).toBeLessThan(0.5);
    expect(Math.abs(point.lon - 101.25)).toBeLessThan(0.5);
  });
});

describe("working out what was typed", () => {
  it("nothing", () => {
    expect(readPlaceInput("   ")).toEqual({ kind: "empty" });
  });

  it("coordinates", () => {
    const read = readPlaceInput("6.87821, 101.27191");
    expect(read).toMatchObject({ kind: "point", from: "coordinates" });
  });

  it("a link, even with the words a chat app puts round it", () => {
    const read = readPlaceInput("บ้านแม่อยู่ตรงนี้ https://maps.google.com/?q=6.87821,101.27191");
    expect(read).toMatchObject({ kind: "point", from: "link" });
  });

  it("a short share link is handed to the server, and only Google's", () => {
    expect(readPlaceInput("https://maps.app.goo.gl/AbCdEf123")).toEqual({
      kind: "shortLink",
      url: "https://maps.app.goo.gl/AbCdEf123",
    });
    expect(readPlaceInput("https://www.google.com/maps/place/Pattani")).toMatchObject({
      kind: "shortLink",
    });
    expect(readPlaceInput("https://example.com/somewhere")).toEqual({ kind: "unknownLink" });
  });

  it("plus codes, full and short", () => {
    expect(readPlaceInput("849VCWC8+R9")).toMatchObject({ kind: "point", from: "plusCode" });
    expect(readPlaceInput("V7HC+7Q เมืองปัตตานี ปัตตานี")).toEqual({
      kind: "shortPlusCode",
      code: "V7HC+7Q",
      locality: "เมืองปัตตานี ปัตตานี",
    });
    expect(readPlaceInput("v7hc+7q Pattani")).toMatchObject({
      kind: "shortPlusCode",
      code: "V7HC+7Q",
    });
  });

  it("anything else is a name to look for", () => {
    expect(readPlaceInput("โรงเรียนบ้านบานา")).toEqual({
      kind: "search",
      query: "โรงเรียนบ้านบานา",
    });
    expect(readPlaceInput("บ้านเลขที่ 12 หมู่ 3 ต.บานา")).toMatchObject({ kind: "search" });
    // A name with a plus in it is not a code.
    expect(readPlaceInput("ร้าน A+B กาแฟ")).toMatchObject({ kind: "search" });
  });
});

describe("the only places the server may follow a link to", () => {
  it("Google's map addresses, in any country", () => {
    for (const host of [
      "maps.app.goo.gl",
      "goo.gl",
      "www.google.com",
      "maps.google.com",
      "www.google.co.th",
      "google.com.my",
      "consent.google.com",
    ]) {
      expect(isMapLinkHost(host)).toBe(true);
    }
  });

  it("and nothing that only looks like them", () => {
    for (const host of [
      "example.com",
      "google.com.evil.example",
      "notgoogle.com",
      "maps.app.goo.gl.example.com",
      "localhost",
      "169.254.169.254",
      "goo.gl.attacker.net",
      // "google." + a shared suffix anyone can register under (A10 security review).
      "google.pp.ua",
      "maps.google.co.com",
    ]) {
      expect(isMapLinkHost(host)).toBe(false);
    }
  });
});
