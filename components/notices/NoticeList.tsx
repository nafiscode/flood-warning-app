"use client";

import { useFormatter, useTranslations } from "next-intl";
import { AlertBadge } from "@/components/alerts/AlertBadge";
import { ClockIcon, LifebuoyIcon, MegaphoneIcon } from "@/components/icons";
import { Link } from "@/i18n/navigation";
import { alertWords } from "@/lib/alert-words";
import type { NoticeItem } from "@/lib/notices";

/**
 * One item of the bell's list. An alert keeps its level badge — icon, word and colour together,
 * never colour alone — and an announcement never borrows an alert's look, so nothing in this
 * list can be mistaken for a warning (safety rules 3 and 10).
 */
function Item({ item, unread, locale }: { item: NoticeItem; unread: boolean; locale: string }) {
  const t = useTranslations("notices");
  const tLevel = useTranslations("alert.level");
  const format = useFormatter();
  const when = format.dateTime(new Date(item.at), {
    timeZone: "Asia/Bangkok",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  const where =
    item.kind === "alert" && item.elsewhere
      ? t("elsewhere", { count: item.elsewhere })
      : item.places.length > 0
        ? item.places.map((place) => place.label).join(", ")
        : t("yourArea");
  const text = (messages: Record<string, string>) => messages[locale] ?? messages.th;

  return (
    <li
      data-notice={item.kind}
      data-unread={unread ? "true" : "false"}
      className={`flex flex-col gap-2 border-t border-jaga-line px-4 py-3 first:border-t-0 ${
        unread ? "bg-jaga-ground" : ""
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        {item.kind === "alert" || item.kind === "alertEnded" ? (
          <AlertBadge level={item.level} />
        ) : item.kind === "announcement" ? (
          <span className="inline-flex items-center gap-2 font-bold text-jaga-ink">
            <MegaphoneIcon size={24} />
            {t("announcement")}
          </span>
        ) : (
          <span className="inline-flex items-center gap-2 font-bold text-jaga-ink">
            <LifebuoyIcon size={24} />
            {item.kind === "autoAlarm"
              ? t("auto.title")
              : item.kind === "fieldWaiting"
                ? t("fieldWaiting.title")
                : item.kind === "report"
                  ? t("report.title")
                  : item.kind === "field"
                    ? t("field.title")
                    : item.kind === "unit"
                      ? t("unit.title")
                      : item.kind === "sos" && item.supplies
                        ? t("supply.title")
                        : t("sos.title")}
          </span>
        )}
        {unread && (
          <span className="rounded-full border border-jaga-edge px-2 text-small font-medium text-jaga-ink">
            {t("new")}
          </span>
        )}
      </div>

      {(item.kind === "alert" || item.kind === "alertEnded") && (
        <p className="font-medium">{where}</p>
      )}
      {/* The line above says which of the person's places; the words say "your area", not the
          alert's whole list of tambons. */}
      {item.kind === "alert" && <p>{alertWords(item.messages, locale, t("yourArea"))}</p>}
      {item.kind === "alertEnded" && <p>{t("ended")}</p>}
      {item.kind === "announcement" && (
        <>
          <p>{text(item.messages)}</p>
          <p className="text-small text-jaga-text-2">{t("announcementNote")}</p>
        </>
      )}
      {item.kind === "unit" && (
        <>
          <p>{t(`unit.${item.event}`, { name: item.unitName })}</p>
          {/* A registration turned down: the admin's reason as they wrote it, then what to do. */}
          {item.event === "rejected" && item.reason && (
            <p className="text-small text-jaga-text-2">
              {t("unit.reason", { reason: item.reason })}
            </p>
          )}
          {item.event === "rejected" && (
            <p className="text-small text-jaga-text-2">{t("unit.rejectedNote")}</p>
          )}
        </>
      )}
      {item.kind === "field" && <p>{t(`field.${item.event}`)}</p>}
      {item.kind === "report" && (
        <p>
          {t(`report.${item.event}`, {
            tambon: item.tambon
              ? locale === "th"
                ? item.tambon.th
                : item.tambon.en
              : t("yourArea"),
          })}
        </p>
      )}
      {item.kind === "fieldWaiting" && <p>{t("fieldWaiting.body", { count: item.count })}</p>}
      {item.kind === "autoAlarm" && (
        <>
          <AlertBadge level={item.level} />
          <p>
            {t(`auto.${item.status}`, {
              level: tLevel(item.level),
              zone: item.zone,
              gauge: item.gauge ?? "–",
              value: item.value ?? "–",
              time: format.dateTime(new Date(item.deadline), {
                timeZone: "Asia/Bangkok",
                hour: "2-digit",
                minute: "2-digit",
              }),
            })}
          </p>
          {item.drill && <p className="text-small text-jaga-text-2">{t("auto.drill")}</p>}
        </>
      )}
      {item.kind === "sos" && (
        <>
          <p>{t(`${item.supplies ? "supply" : "sos"}.${item.event}`)}</p>
          {item.unitName && (
            <p className="text-small text-jaga-text-2">{t("sos.by", { unit: item.unitName })}</p>
          )}
        </>
      )}

      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-small text-jaga-text-2">
        <span className="inline-flex items-center gap-1">
          <ClockIcon size={16} />
          {when}
        </span>
        {item.kind === "sos" && (
          <Link href={`/sos/${item.caseId}`} prefetch={false} className="underline">
            {t("sos.see")}
          </Link>
        )}
        {item.kind === "unit" && (
          <Link href="/requests" prefetch={false} className="underline">
            {t("unit.see")}
          </Link>
        )}
        {item.kind === "fieldWaiting" && (
          <Link href="/admin/field-rescues" prefetch={false} className="underline">
            {t("fieldWaiting.see")}
          </Link>
        )}
        {item.kind === "autoAlarm" && (
          <Link
            href={item.status === "pending" ? "/admin/signals" : "/admin/alerts#auto-alarms"}
            prefetch={false}
            className="underline"
          >
            {t(item.status === "pending" ? "auto.act" : "auto.see")}
          </Link>
        )}
        {item.kind === "field" && (
          <Link href="/authority/field-rescue" prefetch={false} className="underline">
            {t("field.see")}
          </Link>
        )}
        {item.kind === "report" && (
          <Link href="/requests" prefetch={false} className="underline">
            {t("report.see")}
          </Link>
        )}
        {/* An alert leads to the home screen, which shows it in full: level, area, issuer, time,
            reason and next update (safety rule 3). An announcement is complete as it stands. */}
        {(item.kind === "alert" || item.kind === "alertEnded") && (
          <Link href="/" prefetch={false} className="underline">
            {t("see")}
          </Link>
        )}
      </p>
    </li>
  );
}

/** The list itself, used by the panel in the header and by the tests. */
export function NoticeList({
  items,
  read,
  locale,
  emptyHint,
}: {
  items: NoticeItem[];
  read: readonly string[];
  locale: string;
  /** Shown under "nothing here": a visitor with no area chosen is told what to do. */
  emptyHint: string;
}) {
  const t = useTranslations("notices");
  const seen = new Set(read);
  if (items.length === 0) {
    return (
      <div className="px-4 py-5">
        <p className="font-medium">{t("none")}</p>
        <p className="text-small text-jaga-text-2">{emptyHint}</p>
      </div>
    );
  }
  return (
    <ul className="flex flex-col">
      {items.map((item) => (
        <Item key={item.id} item={item} unread={!seen.has(item.id)} locale={locale} />
      ))}
    </ul>
  );
}
