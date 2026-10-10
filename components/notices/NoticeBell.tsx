"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { BellIcon } from "@/components/icons";
import { usePathname } from "@/i18n/navigation";
import type { Area } from "@/lib/area";
import { badgeText } from "@/lib/notices";
import { useStored } from "@/lib/phone-store";
import { useNotices } from "@/lib/use-notices";
import { NoticeList } from "./NoticeList";

/** Nothing is fetched on the SOS screens: there, only the request matters (safety rule 1). */
const QUIET = /^\/sos(\/|$)/;

/**
 * The bell in the header (the owner's request, 10 Oct): what this person missed while the app
 * was closed — alerts for their area and the places they watch, including the ones already
 * lifted, a word from the admins, and the steps of their own SOS.
 *
 * It needs no account: the alerts of a chosen area are public, and what has been read is kept in
 * this browser (and, for someone signed in, with their account as well). Everything it shows was
 * stored on the phone the last time it was read, so the list and the number are there at once
 * and with no connection (safety rule 7).
 */
export function NoticeBell({ className = "" }: { className?: string }) {
  const t = useTranslations("notices");
  const locale = useLocale();
  const format = useFormatter();
  const pathname = usePathname();
  const area = useStored<Area>("area");
  const areaLabel = useCallback(
    (area: Area) => (locale === "en" ? area.nameEn : area.nameTh),
    [locale],
  );
  const { items, unread, read, checkedAt, markAllRead } = useNotices({
    ask: !QUIET.test(pathname),
    homeLabel: t("home"),
    areaLabel,
  });

  // The page the panel was opened on. Leaving that page closes it, without an effect that
  // reaches back into state: the panel simply does not belong to the new page.
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  const open = openedOn === pathname;
  // What was unread when the panel was opened: those keep their "new" mark while it is open,
  // even though opening it is what marks them read.
  const [wasRead, setWasRead] = useState<string[]>([]);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpenedOn(null);
    button.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!panel.current?.contains(target) && !button.current?.contains(target)) setOpenedOn(null);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [open, close]);

  const toggle = () => {
    if (open) {
      close();
      return;
    }
    setWasRead([...read]);
    setOpenedOn(pathname);
    // Opening the bell is reading it: the number goes, the list keeps its "new" marks.
    markAllRead();
  };

  const badge = badgeText(unread);
  return (
    <div className={`relative ${className}`}>
      <button
        ref={button}
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-label={unread > 0 ? t("openWithCount", { count: unread }) : t("open")}
        data-notice-bell={badge ?? "0"}
        // 36 px wide on a phone, with the hit area stretched back out to 48 px by the ::after:
        // at 360 px a full-width button pushed the three links onto a row of their own and made
        // the frozen header 96 px taller. The target stays 48 px (CLAUDE.md).
        className="relative inline-flex min-h-tap w-9 items-center justify-center rounded text-white after:absolute after:-inset-x-1.5 after:inset-y-0 after:content-[''] lg:w-12"
      >
        <span className="relative inline-flex">
          <BellIcon size={24} />
          {badge && (
            // Not colour alone: the number itself is the message, and the button's label says it
            // in words for a screen reader.
            <span className="absolute -end-2 -top-1 min-w-5 rounded-full bg-alert-warning px-1 text-center text-small font-bold leading-5 text-alert-warning-fg">
              {badge}
            </span>
          )}
        </span>
      </button>

      {open && (
        <div
          ref={panel}
          role="dialog"
          aria-label={t("title")}
          data-notice-panel="open"
          // On a phone it stands between the frozen header and the hotline bar, which is never
          // covered: the four numbers stay one tap away (safety rule 4).
          className="fixed inset-x-2 bottom-28 top-28 z-30 overflow-y-auto rounded-xl border border-jaga-line bg-jaga-surface text-jaga-text shadow-lg lg:absolute lg:inset-x-auto lg:bottom-auto lg:end-0 lg:top-12 lg:max-h-[70vh] lg:w-[26rem]"
        >
          <div className="sticky top-0 flex items-center justify-between gap-2 border-b border-jaga-line bg-jaga-surface px-4 py-3">
            <div>
              <h2 className="font-bold text-jaga-ink">{t("title")}</h2>
              <p className="text-small text-jaga-text-2">{t("sub")}</p>
            </div>
            <button
              type="button"
              onClick={close}
              className="inline-flex min-h-tap items-center rounded px-3 font-medium text-jaga-ink underline"
            >
              {t("close")}
            </button>
          </div>
          <NoticeList items={items} read={wasRead} locale={locale} emptyHint={t("noneHint")} />
          {checkedAt !== null && items.length > 0 && (
            <p className="border-t border-jaga-line px-4 py-2 text-small text-jaga-text-2">
              {t("checked", {
                time: format.dateTime(new Date(checkedAt), {
                  timeZone: "Asia/Bangkok",
                  hour: "2-digit",
                  minute: "2-digit",
                }),
              })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
