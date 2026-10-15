import { ALERT_LEVELS, type AlertLevel } from "@/lib/brand/tokens";

export { alertWords, fillArea } from "@/lib/alert-words";

/** One alert in force, as /api/public/status gives it. Times are ISO strings in UTC. */
export type PublicAlert = {
  id: string;
  hazard: string;
  level: AlertLevel;
  reason: string;
  /** Reviewed template text per language; Thai is always there. */
  messages: Record<string, string>;
  issuedAt: string;
  nextUpdateAt: string;
  /** Expected flooding and return windows: always ranges, always estimates (safety rule 8). */
  onset: [string, string] | null;
  returnWindow: [string, string] | null;
  /** Where the information came from. */
  source: string | null;
  tambons: string[];
  /**
   * Published by the automated alarm with no admin acting (safety rule 2's one exception), so the
   * issuer line must not say an admin issued it.
   */
  auto?: boolean;
  /**
   * A dam release notice carries the figures a screen needs to say when the water reaches **this**
   * place: the dam it came from and the time a person said the gates opened. Null on every other
   * alert (spec section 15).
   */
  release: DamRelease | null;
};

export type DamRelease = {
  damCode: string;
  gatesOpenAt: string;
  releaseCms: number | null;
  expectedEndAt: string | null;
};

export type PublicStatus = {
  generatedAt: string;
  /**
   * False until the owner switches the service on at launch (decision 2026-10-08). While false,
   * a tambon without an alert shows "not in service yet", never Normal.
   */
  inService: boolean;
  /** Newest first. */
  alerts: PublicAlert[];
};

/** What a tambon shows. "notInService" and "unknown" are not levels and never look like one. */
export type AreaStatus =
  { kind: "alert"; alert: PublicAlert } | { kind: "normal" } | { kind: "notInService" };

/** The alert in force for a tambon: the newest one that names it. */
export function alertForTambon(
  status: PublicStatus,
  tambon: string,
  hazard = "flood",
): PublicAlert | null {
  return status.alerts.find((a) => a.hazard === hazard && a.tambons.includes(tambon)) ?? null;
}

export function areaStatus(status: PublicStatus, tambon: string): AreaStatus {
  const alert = alertForTambon(status, tambon);
  if (alert) return { kind: "alert", alert };
  return status.inService ? { kind: "normal" } : { kind: "notInService" };
}

/**
 * The reason in the reader's language. An alert made in the console carries its template's
 * reason per language beside the Thai one (`reason_ms`, `reason_en`); anything older, or sent
 * another way, has the Thai reason only.
 */
export function reasonFor(alert: Pick<PublicAlert, "reason" | "messages">, locale: string): string {
  return alert.messages[`reason_${locale}`] ?? alert.reason;
}

/** Past its next-update time. A marker beside the level, never a change of level (rule 3). */
export function isStale(alert: Pick<PublicAlert, "nextUpdateAt">, now: number): boolean {
  return now > Date.parse(alert.nextUpdateAt);
}

/** For ordering only ("most severe first"): return sits just above normal. */
const SEVERITY: Record<AlertLevel, number> = {
  normal: 0,
  return: 1,
  watch: 2,
  warning: 3,
  evacuate: 4,
};

export function severity(status: AreaStatus): number {
  return status.kind === "alert" ? SEVERITY[status.alert.level] : 0;
}

/** True when any tambon has an alert above Normal: the map then opens on the live view. */
export function hasActiveAlerts(status: PublicStatus | null): boolean {
  return !!status && status.alerts.some((a) => a.level !== "normal");
}

function isoOrNull(value: unknown): string | null {
  if (typeof value !== "string" && !(value instanceof Date)) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function range(from: unknown, to: unknown): [string, string] | null {
  const a = isoOrNull(from);
  const b = isoOrNull(to);
  return a && b ? [a, b] : null;
}

/**
 * One row of public_alert_status() as a PublicAlert, or null when it lacks what safety rule 3
 * requires. An alert that can't be shown properly is left out rather than shown half.
 */
export function toPublicAlert(row: Record<string, unknown>): PublicAlert | null {
  const level = row.level as AlertLevel;
  const issuedAt = isoOrNull(row.issued_at);
  const nextUpdateAt = isoOrNull(row.next_update_at);
  const messages = (row.messages ?? {}) as Record<string, unknown>;
  if (
    typeof row.alert_id !== "string" ||
    !ALERT_LEVELS.includes(level) ||
    !issuedAt ||
    !nextUpdateAt ||
    typeof row.reason !== "string" ||
    typeof messages.th !== "string" ||
    !Array.isArray(row.tambons)
  ) {
    return null;
  }
  return {
    id: row.alert_id,
    hazard: String(row.hazard_type),
    level,
    reason: row.reason,
    messages: Object.fromEntries(
      Object.entries(messages).filter((e): e is [string, string] => typeof e[1] === "string"),
    ),
    issuedAt,
    nextUpdateAt,
    onset: range(row.onset_from, row.onset_to),
    returnWindow: range(row.return_from, row.return_to),
    source: typeof row.source === "string" && row.source !== "" ? row.source : null,
    tambons: row.tambons.map(String),
    auto: isAutoAlarm(row.details),
    release: toRelease(row.details),
  };
}

function isAutoAlarm(details: unknown): boolean {
  return (
    !!details &&
    typeof details === "object" &&
    (details as { kind?: unknown }).kind === "auto_alarm"
  );
}

/**
 * The dam release half of an alert, if that is what it is. A notice with no time for the gates is
 * no use to the arrival sums and is dropped: better no clock than one counted from a guess.
 */
function toRelease(details: unknown): DamRelease | null {
  if (!details || typeof details !== "object") return null;
  const d = details as Record<string, unknown>;
  if (d.kind !== "dam_release" || typeof d.damCode !== "string") return null;
  const gatesOpenAt = isoOrNull(d.gatesOpenAt);
  if (!gatesOpenAt) return null;
  const cms = Number(d.releaseCms);
  return {
    damCode: d.damCode,
    gatesOpenAt,
    releaseCms: Number.isFinite(cms) ? cms : null,
    expectedEndAt: isoOrNull(d.expectedEndAt),
  };
}

/**
 * When the gates of this dam opened, according to the notice in force for this person's tambon -
 * and nothing at all when no notice names them. This is the only way a clock time ever reaches
 * the dam screens; the hourly feed lags by hours and can never stand in for it.
 */
export function damReleaseAt(
  status: PublicStatus | null,
  damCode: string,
  tambon: string | null,
): string | null {
  if (!status || !tambon) return null;
  const alert = status.alerts.find(
    (a) => a.release?.damCode === damCode && a.tambons.includes(tambon),
  );
  return alert?.release?.gatesOpenAt ?? null;
}

export const STATUS_URL = "/api/public/status";

declare global {
  interface Window {
    __jagaStatus?: Promise<PublicStatus | null>;
  }
}

/**
 * A few bytes of script for a page's HTML: ask for the alert status at once, while the rest of
 * the app is still downloading (slow 3G). usePublicStatus() picks the answer up.
 */
export const EARLY_STATUS_SCRIPT = `window.__jagaStatus=fetch("${STATUS_URL}",{cache:"no-store"}).then(function(r){return r.ok?r.json():null}).catch(function(){return null})`;
