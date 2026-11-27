/**
 * The public "no team has taken it yet" signal (owner, 27 Nov 2026): which tambons have a request
 * for rescue waiting that no team holds, from `public_unanswered_sos()`. Per tambon and nothing
 * finer - no point, no phone, no sender (safety rule 6).
 *
 * It says "no team yet", never "nobody will come": SOS reaches the admins wherever it is sent from
 * (safety rules 1 and 10), and the copy next to it always points to the hotlines (rule 4).
 */

export const SOS_PULSE_URL = "/api/public/sos-pulse";

/** How often the map asks again while it is open and in front. */
export const SOS_PULSE_POLL_MS = 60_000;

/** A copy older than this is dropped rather than shown: a signal that may have been answered. */
export const SOS_PULSE_FRESH_MS = 5 * 60_000;

/** The SOS red of the brand (app/globals.css `--sos`), for the map's own paint. */
export const SOS_PULSE_COLOR = "#c62828";

/** The three map layers that draw it (components/map/MapView.tsx). */
export const SOS_PULSE_FILL = "jaga-sos-pulse-fill";
export const SOS_PULSE_LINE = "jaga-sos-pulse-line";
export const SOS_PULSE_LABEL = "jaga-sos-pulse-label";

export type SosPulseRow = {
  tambon: string;
  province: string;
  nameTh: string;
  nameEn: string;
  districtTh: string;
  provinceTh: string;
  /** Open rescue requests in this tambon that no team holds. */
  cases: number;
  /** How long the oldest has waited, rounded down to ten minutes. */
  waitingMinutes: number;
};

export type SosPulse = { rows: SosPulseRow[]; asOf: string };

const text = (v: unknown): string => (typeof v === "string" ? v : "");
const whole = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};

/** The database's rows as the map reads them. Rows without a tambon or a case are left out. */
export function toSosPulseRows(rows: readonly Record<string, unknown>[]): SosPulseRow[] {
  return rows
    .map((r) => ({
      tambon: text(r.tambon),
      province: text(r.province_code),
      nameTh: text(r.name_th),
      nameEn: text(r.name_en),
      districtTh: text(r.district_th),
      provinceTh: text(r.province_th),
      cases: whole(r.cases),
      waitingMinutes: whole(r.waiting_minutes),
    }))
    .filter((r) => /^\d{6}$/.test(r.tambon) && r.cases > 0);
}

/** The tambon codes the map pulses on, in a fixed order so the same list is the same string. */
export function pulseCodes(rows: readonly SosPulseRow[] | null | undefined): string[] {
  return [...new Set((rows ?? []).map((r) => r.tambon))].sort();
}

/**
 * The rows to show now: none once the last answer is older than five minutes (no connection, or
 * the edge is serving an error), so a signal that has probably been answered is not left lit.
 */
export function freshPulseRows(
  pulse: SosPulse | null,
  askedAt: number,
  now: number,
): SosPulseRow[] {
  if (!pulse || askedAt === 0) return [];
  return now - askedAt <= SOS_PULSE_FRESH_MS ? pulse.rows : [];
}

/** "2 h 10 min" parts of a waiting time, for the line next to the map. */
export function waitParts(minutes: number): { hours: number; minutes: number } {
  const m = Math.max(0, Math.floor(minutes));
  return { hours: Math.floor(m / 60), minutes: m % 60 };
}
