/** A tambon the person looks at, with a point inside it for ranking safe places. */
export type Area = {
  code: string;
  nameTh: string;
  nameEn: string;
  districtTh: string;
  districtEn: string;
  provinceTh: string;
  provinceEn: string;
  lat: number;
  lon: number;
  /** gps and list are kept on the phone only; account is the home saved in the profile. */
  from: "gps" | "list" | "account";
};

export type Province = {
  code: string;
  nameTh: string;
  nameEn: string;
  status: "active" | "coming_soon";
};

export type TambonEntry = {
  code: string;
  nameTh: string;
  nameEn: string;
  districtCode: string;
  districtTh: string;
  districtEn: string;
  provinceCode: string;
  lat: number;
  lon: number;
};

export type AreaDirectory = { provinces: Province[]; tambons: TambonEntry[] };

/** Answer of /api/geo/locate. */
export type Located =
  { kind: "tambon"; area: Area } | { kind: "notCovered"; province: Province } | { kind: "outside" };

/** Thai names for Thai readers; the official romanized names for Malay and English. */
export function pickName(locale: string, th: string, en: string): string {
  return locale === "th" ? th : en;
}

/** "ต.บานา อ.เมืองปัตตานี จ.ปัตตานี" / "Bana, Mueang Pattani, Pattani". */
export function areaName(locale: string, area: Area): string {
  return locale === "th"
    ? `ต.${area.nameTh} อ.${area.districtTh} จ.${area.provinceTh}`
    : `${area.nameEn}, ${area.districtEn}, ${area.provinceEn}`;
}

export function entryToArea(entry: TambonEntry, province: Province, from: Area["from"]): Area {
  return {
    code: entry.code,
    nameTh: entry.nameTh,
    nameEn: entry.nameEn,
    districtTh: entry.districtTh,
    districtEn: entry.districtEn,
    provinceTh: province.nameTh,
    provinceEn: province.nameEn,
    lat: entry.lat,
    lon: entry.lon,
    from,
  };
}

/** A latitude and longitude from a query string, or null. */
export function parseLatLon(
  lat: string | null,
  lon: string | null,
): { lat: number; lon: number } | null {
  const a = Number.parseFloat(lat ?? "");
  const b = Number.parseFloat(lon ?? "");
  if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a) > 90 || Math.abs(b) > 180) {
    return null;
  }
  return { lat: a, lon: b };
}

/**
 * About 100 m: enough to rank safe places, and the exact position of a home never leaves the
 * phone for that.
 */
export function coarse(value: number): string {
  return value.toFixed(3);
}
