import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import {
  MonitoringFigures,
  MonitoringHeadline,
  MonitoringMark,
} from "@/components/monitoring/MonitoringStatus";
import { monitoringStatus, type Monitoring } from "@/lib/monitoring";
import { reveal } from "@/lib/reveal";
import { card, hint } from "@/lib/ui";

/**
 * The monitoring, as one card with a status line and a way in (the owner, 17 Oct 2026: "just
 * show the status in text and small animated symbol ... if it's clicked it should open up the
 * lower section to show the details").
 *
 * This is the shape on a phone, on a tablet and on the home screen; on a laptop's map the same
 * status is the fifth readout across the top of the console and the detail opens in a band under
 * the dashboard, so the card itself is not drawn there.
 *
 * It carries no alert colour, no badge and none of the level icons: what it reports are
 * measurements, and only a person issues a level (safety rule 2). The detail is rendered by the
 * caller and passed in, so one open/closed state can drive both this and the console's band.
 */
export type MonitoringCardProps = {
  summary: Monitoring;
  time: (iso: string) => string;
  open: boolean;
  onToggle: () => void;
  /** The opened detail. Rendered inside the card, under the status line. */
  detail: ReactNode;
  place: "home" | "map";
};

export function MonitoringCard(props: MonitoringCardProps) {
  const t = useTranslations("monitoring");
  const status = monitoringStatus(props.summary);
  if (props.summary.notes.length === 0) return null;
  const id = `monitoring-detail-${props.place}`;

  return (
    <section className={card} data-monitoring-card={props.place}>
      <h2 className="text-body font-bold text-jaga-ink">{t("title")}</h2>
      <p className="flex items-start gap-2 text-h3 font-bold leading-tight text-jaga-ink">
        <span className="mt-1.5">
          <MonitoringMark status={status} />
        </span>
        <MonitoringHeadline status={status} />
      </p>
      <p className={hint}>
        <MonitoringFigures status={status} time={props.time} />
      </p>
      <button
        type="button"
        data-monitoring-open={props.open ? "true" : "false"}
        aria-expanded={props.open}
        aria-controls={id}
        onClick={() => {
          /*
           * Opening it is not enough: the detail appears under the button, and on a phone that
           * is below the fold (the owner, 17 Oct - the button "should also bring user to see the
           * detail section"). Only on the way open; closing it must leave the page where it is.
           */
          if (!props.open) reveal(() => document.getElementById(id));
          props.onToggle();
        }}
        className="min-h-tap self-start underline"
      >
        {t(props.open ? "hideDetail" : "showDetail")}
      </button>
      {props.open && (
        <div
          id={id}
          tabIndex={-1}
          className="flex flex-col gap-6 border-t border-jaga-line pt-4 focus-visible:outline-none"
        >
          {props.detail}
        </div>
      )}
      {/* Said whether it is open or shut: the line above is a reading, not a level. */}
      <p className={hint}>{t("notAnAlert")}</p>
    </section>
  );
}
