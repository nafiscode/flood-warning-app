import { inService } from "@/lib/features";
import { levelTally, type LevelTally } from "@/lib/map-console";
import { GAUGE_STATUSES, type Gauge } from "@/lib/map-data";
import { toPublicAlert, type PublicAlert, type PublicStatus } from "@/lib/public-status";
import { supabaseConfigured } from "@/lib/supabase/env";
import { createPublicClient } from "@/lib/supabase/public";

/**
 * The places that have a flood page of their own, at /flood/<slug> (A10, 21 Oct 2026).
 *
 * These pages exist because of search. Measured on 21 October, jagaapp.org did not appear in a
 * search for its own name, and because the map is drawn in the browser no page anywhere on the
 * site had a place name in its text for a crawler to read. Each of these is a page a local flood
 * search can land on, and - because it is drawn on the server with no JavaScript - a page that
 * opens for somebody on a failing connection who has never heard of Jaga.
 *
 * Everything on them is aggregate and already public: how many tambons stand at each level, the
 * river gauges as the map already shows them, and how many safe places there are. No SOS, no
 * report, no reporter, no exact location (safety rules 5 and 6).
 */

export type PlaceKind = "province" | "district";

/**
 * Slug to DOPA code. Provinces first, then the districts people type the name of.
 *
 * Not every district gets one. Forty-nine pages differing only in a place name would be the kind
 * of thin, near-identical set a search engine discounts, and would be no use to a reader either.
 * These eleven are places searched as names in their own right: the four provincial towns, Hat Yai
 * (the owner's own note, 21 Oct - it is searched far more than Songkhla is, and its floods have
 * their own history), the border and coastal towns, and Bannang Sata, which floods when Bang Lang
 * releases. Adding another is one line here.
 */
export const PLACES: Record<string, { code: string; kind: PlaceKind }> = {
  // The four covered provinces.
  pattani: { code: "94", kind: "province" },
  yala: { code: "95", kind: "province" },
  narathiwat: { code: "96", kind: "province" },
  songkhla: { code: "90", kind: "province" },
  // Districts searched by name.
  "hat-yai": { code: "9011", kind: "district" },
  "mueang-songkhla": { code: "9001", kind: "district" },
  "mueang-pattani": { code: "9401", kind: "district" },
  "mueang-yala": { code: "9501", kind: "district" },
  "mueang-narathiwat": { code: "9601", kind: "district" },
  betong: { code: "9502", kind: "district" },
  "su-ngai-kolok": { code: "9610", kind: "district" },
  "sai-buri": { code: "9407", kind: "district" },
  "tak-bai": { code: "9602", kind: "district" },
  sadao: { code: "9010", kind: "district" },
  "bannang-sata": { code: "9503", kind: "district" },
};

export const PLACE_SLUGS = Object.keys(PLACES);

/** Where each page lives, for the sitemap and the hreflang sets (lib/seo.ts). */
export const PLACE_PATHS = PLACE_SLUGS.map((slug) => `/flood/${slug}`);

/** The four provinces, for the "other provinces Jaga covers" list at the foot of every page. */
export const PROVINCE_SLUGS = PLACE_SLUGS.filter((slug) => PLACES[slug]!.kind === "province");

export function isPlaceSlug(value: string): boolean {
  return Object.hasOwn(PLACES, value) && PLACES[value] !== undefined;
}

/** One gauge on a flood page: the same fields the map shows, and nothing more. */
export type PlaceGauge = Pick<Gauge, "name" | "status" | "value" | "observedAt" | "rise3h"> & {
  code: string;
  basin: string | null;
  bank: number | null;
};

export type PlaceTambon = { code: string; nameTh: string; nameEn: string };

/** The answer of `area_public_summary()`. */
export type PlaceSummary = {
  tambons: number;
  gauges: PlaceGauge[];
  /** A district's own tambons by name; null for a province, whose list would be a hundred long. */
  tambonList: PlaceTambon[] | null;
  places: { total: number; verified: number };
};

/**
 * What one flood page needs. Each piece is separately nullable on purpose: a page that could not
 * read the alerts must say so and never show an empty list - "no alert is in force here" and
 * "Jaga could not reach its database" are opposite facts and only one of them is ever true
 * (safety rule 10, and the rule the public endpoints already follow).
 */
export type PlaceView = {
  slug: string;
  code: string;
  kind: PlaceKind;
  /** Null when the alerts could not be read. */
  status: PublicStatus | null;
  /** Alerts in force naming a tambon of this place, newest first. Empty is meaningful. */
  alerts: PublicAlert[];
  tally: LevelTally[];
  /** Null when the summary could not be read. */
  summary: PlaceSummary | null;
};

function toGauge(row: Record<string, unknown>): PlaceGauge {
  const num = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
  const status = String(row.status);
  return {
    code: String(row.code ?? ""),
    name: (row.name ?? {}) as Record<string, string>,
    basin: typeof row.basin === "string" ? row.basin : null,
    value: num(row.value),
    observedAt: typeof row.observedAt === "string" ? row.observedAt : null,
    rise3h: num(row.rise3h),
    bank: num(row.bank),
    status: (GAUGE_STATUSES as readonly string[]).includes(status)
      ? (status as PlaceGauge["status"])
      : "no_recent_data",
  };
}

function toSummary(value: unknown): PlaceSummary | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (!Array.isArray(row.gauges)) return null;
  const places = (row.places ?? {}) as Record<string, unknown>;
  const count = (v: unknown) => (typeof v === "number" && v >= 0 ? v : 0);
  return {
    tambons: count(row.tambons),
    gauges: (row.gauges as Record<string, unknown>[]).map(toGauge),
    tambonList: Array.isArray(row.tambonList) ? (row.tambonList as PlaceTambon[]) : null,
    places: { total: count(places.total), verified: count(places.verified) },
  };
}

/**
 * The alerts in force naming at least one tambon of this place. A tambon code starts with its
 * district code, which starts with its province code, so the same prefix test serves both.
 */
export function alertsIn(code: string, alerts: readonly PublicAlert[]): PublicAlert[] {
  return alerts.filter((alert) => alert.tambons.some((tambon) => tambon.startsWith(code)));
}

/**
 * District names, from the `districts` table rather than from `messages/`: these are official DOPA
 * names, reference data Jaga already holds, not copy to be translated. Thai gets the Thai name;
 * Malay and English both get the Roman one, as province names already do.
 *
 * Every code the page needs in one query - the district itself and the neighbours it links to.
 * One at a time would be up to eight reads per page render, against a page that re-renders every
 * 60 s in three languages for eleven districts, which is a lot of database for a list of names.
 */
export async function districtNames(
  codes: readonly string[],
  locale: string,
): Promise<Record<string, string>> {
  if (!supabaseConfigured() || codes.length === 0) return {};
  const { data, error } = await createPublicClient()
    .from("districts")
    .select("code, name_th, name_en")
    .in("code", [...codes]);
  if (error || !data) return {};
  const rows = data as { code: string; name_th: string; name_en: string }[];
  return Object.fromEntries(
    rows.map((row) => [row.code, locale === "th" ? row.name_th : row.name_en]),
  );
}

/**
 * Read one place. Two reads in parallel, both public: the alerts in force (the same
 * `public_alert_status()` the home screen and the map read, so the three can never disagree) and
 * the area's own summary.
 */
export async function readPlace(slug: string): Promise<PlaceView> {
  const place = PLACES[slug]!;
  const base: PlaceView = {
    slug,
    code: place.code,
    kind: place.kind,
    status: null,
    alerts: [],
    tally: [],
    summary: null,
  };
  if (!supabaseConfigured()) return base;
  const supabase = createPublicClient();
  const [statusRead, summaryRead] = await Promise.all([
    supabase.rpc("public_alert_status"),
    supabase.rpc("area_public_summary", { p_code: place.code }),
  ]);

  let status: PublicStatus | null = null;
  let alerts: PublicAlert[] = [];
  if (!statusRead.error && Array.isArray(statusRead.data)) {
    const all = (statusRead.data as Record<string, unknown>[])
      .map(toPublicAlert)
      .filter((alert): alert is PublicAlert => alert !== null);
    status = { generatedAt: new Date().toISOString(), inService: inService(), alerts: all };
    alerts = alertsIn(place.code, all);
  }

  return {
    ...base,
    status,
    alerts,
    tally: levelTally(alerts),
    summary: summaryRead.error ? null : toSummary(summaryRead.data),
  };
}
