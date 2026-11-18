import { useTranslations } from "next-intl";
import { ClockIcon, DropIcon, MessageIcon, RainIcon, WaveIcon } from "@/components/icons";
import type { MonitoringStatus, Note, StatusKind } from "@/lib/monitoring";
import styles from "@/components/map/FeatureIcon.module.css";

/**
 * The status line every entrance to the monitoring wears: a small moving mark and one sentence
 * (the owner, 17 Oct 2026 - "just show the status in text and small animated symbol saying
 * everything is normal").
 *
 * **The mark says "live", not "safe".** It is the same slow pulse the map's feature chips use,
 * in the page's own teal, and it moves identically in all four states - so it can never be read
 * as a green light. What changes between the states is the words. None of the five level icons
 * appears here, and no alert colour: the only level on either screen is the published one
 * (safety rule 2, docs/brand.md).
 *
 * The owner chose, on 17 Oct, that "normal" speaks about the **readings** and not the situation:
 * all measurements within their normal range, with how many are reporting and when. A plain "the
 * situation is normal" would be an all-clear worked out by code from feeds that lag by hours
 * (safety rule 10).
 */

/** The kind of thing the lead note is about: a river, a reservoir, residents, the sky. */
const NOTE_ICON: Record<Note["kind"], typeof WaveIcon> = {
  gauges: WaveIcon,
  dam: DropIcon,
  reports: MessageIcon,
  rain: RainIcon,
};

export function MonitoringPulse({ size = 12 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 12 12"
      className="shrink-0"
      data-monitoring-pulse="true"
    >
      <circle cx="6" cy="6" r="6" className={`fill-jaga-teal-ink ${styles.live}`} />
    </svg>
  );
}

/** The mark beside the words: the pulse, and the kind of thing when something is happening. */
export function MonitoringMark({ status }: { status: MonitoringStatus }) {
  const Icon = status.lead ? NOTE_ICON[status.lead.kind] : null;
  return (
    <span className="flex items-center gap-2">
      <MonitoringPulse />
      {status.kind === "unknown" || status.kind === "incomplete" ? (
        <ClockIcon size={22} aria-hidden="true" className="shrink-0 text-jaga-text-2" />
      ) : (
        Icon && <Icon size={22} aria-hidden="true" className="shrink-0" />
      )}
    </span>
  );
}

/** What the lead note is, in a handful of words: never the sentence, which the detail carries. */
function leadWord(status: MonitoringStatus, t: ReturnType<typeof useTranslations>): string {
  const note = status.lead;
  if (!note) return "";
  if (note.kind === "gauges") {
    /*
     * A bank reached outranks a bank approached, and both outrank a river on its way up - but a
     * river on its way up is said plainly when it is all there is (the owner, 18 Nov 2026). It
     * is counted across the reader's own areas, the way the two bank lines above it already are,
     * so the three sentences can be read against each other without changing scope.
     */
    if (note.over > 0) return t("lead.riversOver", { count: note.over });
    if (note.near > 0) return t("lead.riversNear", { count: note.near });
    return t("lead.riversRising", { count: note.rising });
  }
  if (note.kind === "dam") {
    return note.attention === "releasing" || (note.spilledCms ?? 0) > 0
      ? t("lead.damReleasing")
      : t("lead.damWatch");
  }
  if (note.kind === "reports") return t("lead.reports", { count: note.reports });
  /*
   * The sky, and the one place in the monitoring that looks forward. Rain to come is said before
   * rain falling, because it is the half a reader can still act on; "heavy" is the model's own
   * word for those hours and never a figure of ours (`isHeavy`). The hours are in the words, so
   * the line cannot be read as a claim about the rest of the day (safety rule 8).
   */
  if (note.soon?.wet) {
    return t(note.soon.heavy ? "lead.rainSoonHeavy" : "lead.rainSoon", {
      hours: note.soon.hours,
      mm: note.soon.mm,
    });
  }
  return t("lead.rain");
}

/** The headline, in one line. The figures beneath it are the caller's to place. */
export function MonitoringHeadline({ status }: { status: MonitoringStatus }) {
  const t = useTranslations("monitoring.status");
  const kind: StatusKind = status.kind;
  return (
    <span data-monitoring-status={kind}>{kind === "watching" ? leadWord(status, t) : t(kind)}</span>
  );
}

/**
 * The line under the headline: how many rivers are reporting and when the newest reading was
 * taken, so the headline is never read without its own age (safety rules 3 and 8).
 */
export function MonitoringFigures({
  status,
  time,
}: {
  status: MonitoringStatus;
  time: (iso: string) => string;
}) {
  const t = useTranslations("monitoring.status");
  const parts: string[] = [];
  if (status.total > 0) {
    parts.push(t("reporting", { reporting: status.reporting, total: status.total }));
  }
  if (status.newestAt) parts.push(time(status.newestAt));
  if (status.kind !== "unknown" && status.unknowns > 0) parts.push(t("someMissing"));
  return <>{parts.join(" · ")}</>;
}
