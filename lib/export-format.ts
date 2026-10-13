/**
 * Turning rows into the two files an export offers (spec 6.5). Pure, so it is unit-tested: a
 * spreadsheet that opens a cell as a formula, or a GeoJSON with latitude and longitude the wrong
 * way round, is the kind of fault nobody notices until the file is already with someone else.
 */

export type ExportRow = Record<string, unknown>;

function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text =
    value instanceof Date
      ? value.toISOString()
      : Array.isArray(value)
        ? value.join(" ")
        : typeof value === "object"
          ? JSON.stringify(value)
          : String(value);
  // A cell starting with = + - or @ is run as a formula by spreadsheet programs.
  if (/^[=+\-@\t\r]/.test(text) && typeof value === "string") text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** RFC 4180 CSV with a header row and a byte-order mark, so Excel reads Thai as UTF-8. */
export function toCsv(rows: readonly ExportRow[], columns: readonly string[]): string {
  const lines = [columns.join(","), ...rows.map((r) => columns.map((c) => cell(r[c])).join(","))];
  return `﻿${lines.join("\r\n")}\r\n`;
}

type Geometry = { type: string; coordinates: unknown };

/**
 * A FeatureCollection in EPSG:4326. A row's own `geometry` is used when it has one (an alert's
 * outline); otherwise a point from `lon`, `lat` - in that order, as GeoJSON wants. Rows with
 * neither are left out rather than placed at 0,0.
 */
export function toGeoJson(rows: readonly ExportRow[], columns: readonly string[]): string {
  const features = rows.flatMap((r) => {
    const own = r.geometry as Geometry | null | undefined;
    const lat = Number(r.lat);
    const lon = Number(r.lon);
    const geometry: Geometry | null =
      own && typeof own === "object" && typeof own.type === "string"
        ? own
        : r.lat !== null && r.lon !== null && Number.isFinite(lat) && Number.isFinite(lon)
          ? { type: "Point", coordinates: [lon, lat] }
          : null;
    if (!geometry) return [];
    const properties = Object.fromEntries(
      columns
        .filter((c) => c !== "lat" && c !== "lon" && c !== "geometry")
        .map((c) => [c, r[c] instanceof Date ? (r[c] as Date).toISOString() : (r[c] ?? null)]),
    );
    return [{ type: "Feature", geometry, properties }];
  });
  return JSON.stringify({ type: "FeatureCollection", features });
}

export const EXPORTS = {
  sos: {
    columns: [
      "sos_id",
      "created_at",
      "closed_at",
      "kind",
      "status",
      "hazard_type",
      "tambon",
      "province",
      "lat",
      "lon",
      "people_count",
      "depth_ref",
      "merged",
      "minutes_to_accept",
    ],
  },
  reports: {
    columns: [
      "report_id",
      "created_at",
      "hazard_type",
      "tambon",
      "province",
      "lat",
      "lon",
      "depth_ref",
      "trend",
      "road_access",
      "moderation_status",
      "photos",
    ],
  },
  alerts: {
    columns: [
      "alert_id",
      "issued_at",
      "ended_at",
      "level",
      "hazard_type",
      "drill",
      "state",
      "next_update_at",
      "reason",
      "tambons",
      "geometry",
    ],
  },
} as const;

export type ExportKind = keyof typeof EXPORTS;
export const EXPORT_DAYS = [7, 30, 90, 365] as const;

export function exportKind(value: unknown): ExportKind | null {
  return typeof value === "string" && value in EXPORTS ? (value as ExportKind) : null;
}

export function exportDays(value: unknown): number {
  const days = Number(value);
  return (EXPORT_DAYS as readonly number[]).includes(days) ? days : 30;
}

/** "jaga-sos-anonymized-30d-2026-11-20.csv": says what is in it before it is opened. */
export function exportFileName(
  kind: ExportKind,
  format: "csv" | "geojson",
  days: number,
  anonymized: boolean,
  today: string,
): string {
  const anon = kind === "sos" ? (anonymized ? "-anonymized" : "-full") : "";
  return `jaga-${kind}${anon}-${days}d-${today}.${format}`;
}
