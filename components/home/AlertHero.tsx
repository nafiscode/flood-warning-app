import { useFormatter, useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { AlertBadge } from "@/components/alerts/AlertBadge";
import { AlertStatus } from "@/components/alerts/AlertStatus";
import { ClockIcon } from "@/components/icons";
import type { AlertLevel } from "@/lib/brand/tokens";
import type { AreaStatus, PublicAlert } from "@/lib/public-status";
import { BANGKOK_DATE_TIME } from "@/lib/time";
import { hint } from "@/lib/ui";

/** "unknown": the status couldn't be loaded. Like "notInService", it is not a level. */
export type HeroStatus = AreaStatus | { kind: "unknown" };

const LEVEL_BORDER: Record<AlertLevel, string> = {
  normal: "border-alert-normal",
  watch: "border-alert-watch",
  warning: "border-alert-warning",
  evacuate: "border-alert-evacuate",
  return: "border-alert-return",
};

type Props = {
  status: HeroStatus;
  /** The area's name and the "change" control, shown above the level. */
  area: ReactNode;
  now: number;
  /** Shown under an "unknown" status. */
  onRetry?: () => void;
};

/** The reviewed alert text in the reader's language; Thai when there is no reviewed translation. */
function alertText(alert: PublicAlert, locale: string): string {
  return alert.messages[locale] ?? alert.messages.th ?? "";
}

function Row({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex flex-col">
      <dt className={hint}>{term}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}

/**
 * The hero of the home screen (spec 4.1): the level for the person's tambon with everything
 * safety rule 3 asks for: level, area, issuer, issue time, reason and next update. A late alert
 * keeps its level and gets the grey marker beside it. The two states that are not levels ("not
 * in service yet", "couldn't load") are grey cards without any level badge or color.
 */
export function AlertHero({ status, area, now, onRetry }: Props) {
  const t = useTranslations("home");
  const tAlert = useTranslations("alert");
  const locale = useLocale();
  const format = useFormatter();
  const time = (iso: string) => format.dateTime(new Date(iso), BANGKOK_DATE_TIME);
  const range = (r: [string, string]) => t("range", { from: time(r[0]), to: time(r[1]) });

  if (status.kind === "notInService" || status.kind === "unknown") {
    const unknown = status.kind === "unknown";
    return (
      <section
        data-hero={status.kind}
        className="flex flex-col gap-3 rounded-2xl border-2 border-alert-stale bg-jaga-surface p-5"
      >
        {area}
        <h2 className="flex items-center gap-2 text-h3 font-bold text-jaga-text">
          <ClockIcon size={28} />
          {unknown ? t("status.unavailableTitle") : t("notInService.title")}
        </h2>
        <p>{unknown ? t("status.unavailableBody") : t("notInService.body")}</p>
        {!unknown && <p className="font-bold">{t("notInService.emergency")}</p>}
        {unknown && onRetry && (
          <button type="button" onClick={onRetry} className="min-h-tap self-start underline">
            {t("status.retry")}
          </button>
        )}
      </section>
    );
  }

  if (status.kind === "normal") {
    return (
      <section
        data-hero="normal"
        className={`flex flex-col gap-3 rounded-2xl border-4 bg-jaga-surface p-5 ${LEVEL_BORDER.normal}`}
      >
        {area}
        <AlertBadge level="normal" size="hero" />
        <p className="text-h3 font-bold">{tAlert("summary.normal")}</p>
        <p>{t("normalBody")}</p>
      </section>
    );
  }

  const { alert } = status;
  const text = alertText(alert, locale);
  return (
    <section
      data-hero="alert"
      className={`flex flex-col gap-3 rounded-2xl border-4 bg-jaga-surface p-5 ${LEVEL_BORDER[alert.level]}`}
    >
      {area}
      <AlertStatus
        level={alert.level}
        nextUpdateAt={new Date(alert.nextUpdateAt)}
        now={new Date(now)}
        size="hero"
      />
      <p className="text-h3 font-bold">{tAlert(`summary.${alert.level}`)}</p>
      {text !== "" && <p lang={alert.messages[locale] ? locale : "th"}>{text}</p>}
      {(alert.onset || alert.returnWindow) && (
        <div className="flex flex-col gap-2 rounded-xl bg-jaga-ground p-3" data-estimate="true">
          <dl className="flex flex-col gap-2">
            {alert.onset && <Row term={t("onset")}>{range(alert.onset)}</Row>}
            {alert.returnWindow && <Row term={t("returnWindow")}>{range(alert.returnWindow)}</Row>}
          </dl>
          <p className={hint}>{t("estimate")}</p>
        </div>
      )}
      <dl className="flex flex-col gap-2">
        <Row term={t("reason")}>{alert.reason}</Row>
        <Row term={t("issuedBy")}>{t("issuer")}</Row>
        {alert.source && <Row term={t("source")}>{alert.source}</Row>}
        <div className="grid grid-cols-2 gap-2">
          <Row term={t("issued")}>{time(alert.issuedAt)}</Row>
          <Row term={t("nextUpdate")}>{time(alert.nextUpdateAt)}</Row>
        </div>
      </dl>
    </section>
  );
}
