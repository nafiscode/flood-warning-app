import type { AlertLevel } from "@/lib/brand/tokens";
import { AlertBadge } from "./AlertBadge";
import { StaleMarker } from "./StaleMarker";

type Props = {
  level: AlertLevel;
  /** When the alert said it would be updated next. */
  nextUpdateAt: Date;
  /** Injected for tests and previews; defaults to now. */
  now?: Date;
  size?: "md" | "hero";
};

/**
 * The level badge, plus the stale marker once the next-update time has passed.
 * The badge is always rendered with the issued level; staleness only adds a marker.
 */
export function AlertStatus({ level, nextUpdateAt, now = new Date(), size = "md" }: Props) {
  const stale = now.getTime() > nextUpdateAt.getTime();
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <AlertBadge level={level} size={size} />
      {stale && <StaleMarker since={nextUpdateAt} />}
    </span>
  );
}
