/**
 * The plan page's reads, on the server, with the admin's own session: every function refuses
 * anyone who is not an admin. Each read says "missing" instead of throwing when the database does
 * not have the function yet (the migration is applied by the owner), so the page can still open
 * and say what it is waiting for.
 */
import { PLAN_SERVICES, type PlanReading, type PlanService } from "@/lib/plan-limits";
import { createClient } from "@/lib/supabase/server";

export type StoredReading = PlanReading & { id: number; byMe: boolean };

export type PlanHealth = {
  at: string;
  dbBytes: number;
  storageBytes: number;
  statsReset: string | null;
  cacheHit: number | null;
  connections: number;
  authUsers: number;
  writers: { table: string; writes: number; dead: number; live: number; bytes: number }[];
  crons: { name: string; schedule: string; active: boolean; runs: number; failed: number }[];
  cronLog: { rows: number; bytes: number };
  io: { read: number; write: number } | null;
};

type Row = {
  id: number;
  service: string;
  meter: string;
  value: number;
  read_at: string;
  resets_on: string | null;
  note: string | null;
  auto: boolean;
  by_me: boolean;
};

/** The last 120 days of readings, oldest first; null when the database has no such table yet. */
export async function readPlanReadings(): Promise<StoredReading[] | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_plan_readings", { p_days: 120 });
  if (error || !Array.isArray(data)) return null;
  return (data as Row[])
    .filter((r) => (PLAN_SERVICES as readonly string[]).includes(r.service))
    .map((r) => ({
      id: r.id,
      service: r.service as PlanService,
      meter: r.meter,
      value: r.value,
      at: r.read_at,
      resetsOn: r.resets_on,
      note: r.note,
      auto: r.auto,
      byMe: r.by_me,
    }));
}

/** What the database says about itself; null when it cannot be asked. */
export async function readPlanHealth(): Promise<PlanHealth | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_plan_health");
  if (error || !data || typeof data !== "object") return null;
  return data as PlanHealth;
}

/** Bytes as people read them: "71 MB", "1.2 GB". */
export function bytesText(bytes: number, locale: string): string {
  const n = (v: number, digits: number) =>
    new Intl.NumberFormat(locale === "th" ? "th-TH" : locale === "ms" ? "ms-MY" : "en-GB", {
      maximumFractionDigits: digits,
    }).format(v);
  if (bytes >= 1e9) return `${n(bytes / 1e9, 2)} GB`;
  if (bytes >= 1e6) return `${n(bytes / 1e6, 1)} MB`;
  return `${n(bytes / 1e3, 0)} kB`;
}

/**
 * How much the nightly snapshots say was read and written a day: the difference of two totals over
 * the days between them. A total that went down means the counters were reset (a restart or a
 * restore), and that pair says nothing.
 */
export function ioPerDay(
  readings: readonly PlanReading[],
  meter: "io_read_gb" | "io_write_gb",
): number | null {
  const series = readings
    .filter((r) => r.meter === meter)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const deltas: number[] = [];
  for (let i = 1; i < series.length; i++) {
    const days = (Date.parse(series[i]!.at) - Date.parse(series[i - 1]!.at)) / 86_400_000;
    const gb = series[i]!.value - series[i - 1]!.value;
    if (days >= 0.5 && gb >= 0) deltas.push(gb / days);
  }
  const lastWeek = deltas.slice(-7);
  if (lastWeek.length === 0) return null;
  return lastWeek.reduce((a, b) => a + b, 0) / lastWeek.length;
}
