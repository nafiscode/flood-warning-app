import type { ExpressionSpecification } from "maplibre-gl";
import { alert as alertColors, type AlertLevel } from "@/lib/brand/tokens";
import { isStale, type PublicAlert, type PublicStatus } from "@/lib/public-status";

const NOTHING = "rgba(0, 0, 0, 0)";

function rgba(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** The alert in force for each tambon that has one: the newest alert naming it wins. */
export function alertByTambon(status: PublicStatus): Map<string, PublicAlert> {
  const byTambon = new Map<string, PublicAlert>();
  for (const alert of status.alerts) {
    if (alert.hazard !== "flood") continue;
    for (const code of alert.tambons) if (!byTambon.has(code)) byTambon.set(code, alert);
  }
  return byTambon;
}

/**
 * Fill color of the tambon layer by alert level. A tambon without an alert is light green only
 * when the service is running; before launch, and when the status is unknown, it gets no color
 * at all (safety rule 10). The colors are the alert palette; the legend and the panel that opens
 * on a tap carry the icon and the words.
 */
export function alertFillColor(status: PublicStatus | null): ExpressionSpecification | string {
  if (!status) return NOTHING;
  const codes: Record<AlertLevel, string[]> = {
    normal: [],
    watch: [],
    warning: [],
    evacuate: [],
    return: [],
  };
  for (const [code, alert] of alertByTambon(status)) codes[alert.level].push(code);
  const rest = status.inService ? rgba(alertColors.normal.bg, 0.2) : NOTHING;
  const cases = (Object.keys(codes) as AlertLevel[])
    .filter((level) => codes[level].length > 0)
    .flatMap((level) => [
      codes[level],
      rgba(alertColors[level].bg, level === "normal" ? 0.2 : 0.55),
    ]);
  if (cases.length === 0) return rest;
  return ["match", ["get", "code"], ...cases, rest] as unknown as ExpressionSpecification;
}

/** Tambons whose alert is past its next-update time: outlined in grey, level color kept. */
export function staleTambons(status: PublicStatus | null, now: number): string[] {
  if (!status) return [];
  return [...alertByTambon(status)].filter(([, a]) => isStale(a, now)).map(([code]) => code);
}

export const STALE_COLOR = alertColors.stale.bg;
