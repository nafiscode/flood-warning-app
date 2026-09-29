import { useFormatter, useTranslations } from "next-intl";
import { ClockIcon } from "@/components/icons";

/**
 * Grey "not updated since [time]" marker. It is a marker, not a level: it always sits
 * beside the level badge and never replaces or downgrades it (safety rule 3).
 */
export function StaleMarker({ since }: { since: Date }) {
  const t = useTranslations("alert");
  const format = useFormatter();
  const time = format.dateTime(since, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "Asia/Bangkok",
  });
  return (
    <span
      data-stale="true"
      className="inline-flex min-h-tap items-center gap-2 rounded-lg bg-alert-stale px-3 py-1 text-small font-medium text-alert-stale-fg"
    >
      <ClockIcon size={20} />
      <span>{t("stale", { time })}</span>
    </span>
  );
}
