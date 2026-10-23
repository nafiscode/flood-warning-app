/**
 * What a visitor's text means when they have not signed in (the owner, 23 Oct 2026): the box on the
 * home screen's area chooser and the one over the SOS pin map. The signed-in box (components/
 * account/PlaceFinder.tsx) also asks OpenStreetMap for landmarks and follows shared map links; that
 * goes through a server route that needs an account, on purpose, so Jaga is not an open door to
 * someone else's free service. For everyone else the box does only what can be done with nothing
 * but Jaga's own list of tambons and the text itself:
 *
 *   - numbers copied from a map, a long map link, a full Plus Code: a point, read in the browser,
 *     so it works with no signal at all, which matters most at the SOS screen;
 *   - a short Plus Code with a town: completed from Jaga's own list;
 *   - a name: Jaga's tambons and districts, best first.
 *
 * A short share link cannot be followed without the server, so it says so rather than guess.
 * Pure: the component fetches the directory and calls this.
 */
import type { AreaDirectory } from "@/lib/area";
import { readPlaceInput, type Point } from "@/lib/place-input";
import {
  placeFromShortCode,
  searchDirectory,
  type DirectoryRow,
  type FoundPlace,
} from "@/lib/place-search";

export type Lookup =
  | { kind: "empty" }
  | { kind: "point"; point: Point }
  /** A link from a map app that only its own server can open: use the numbers or a long link. */
  | { kind: "shortLink" }
  | { kind: "unknownLink" }
  | { kind: "places"; places: FoundPlace[] }
  /** The text is a name (or a short code) and Jaga's list has not arrived yet. */
  | { kind: "needsDirectory" };

/** Jaga's tambons as the search reads them. */
export function rowsFromDirectory(directory: AreaDirectory): DirectoryRow[] {
  const provinces = new Map(directory.provinces.map((p) => [p.code, p]));
  return directory.tambons.map((t) => ({
    code: t.code,
    nameTh: t.nameTh,
    nameEn: t.nameEn,
    districtTh: t.districtTh,
    districtEn: t.districtEn,
    provinceTh: provinces.get(t.provinceCode)?.nameTh ?? "",
    provinceEn: provinces.get(t.provinceCode)?.nameEn ?? "",
    lat: t.lat,
    lon: t.lon,
  }));
}

export function lookupLocation(raw: string, rows: DirectoryRow[] | null, locale: string): Lookup {
  const read = readPlaceInput(raw);
  switch (read.kind) {
    case "empty":
      return { kind: "empty" };
    case "point":
      return { kind: "point", point: read.point };
    case "shortLink":
      return { kind: "shortLink" };
    case "unknownLink":
      return { kind: "unknownLink" };
    case "shortPlusCode": {
      if (!rows) return { kind: "needsDirectory" };
      const place = placeFromShortCode(read.code, read.locality, rows, null);
      return place
        ? { kind: "point", point: { lat: place.lat, lon: place.lon } }
        : { kind: "places", places: [] };
    }
    case "search":
      if (!rows) return { kind: "needsDirectory" };
      return { kind: "places", places: searchDirectory(read.query, rows, locale) };
  }
}
