"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { AboutLink } from "@/components/AboutLink";
import { AccountLink } from "@/components/AccountLink";
import { AdminLink } from "@/components/AdminLink";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ThaiClock } from "@/components/ThaiClock";
import { ThemeSwitch } from "@/components/ThemeSwitch";
import { CrossIcon, MenuIcon } from "@/components/icons";
import { usePathname } from "@/i18n/navigation";

/**
 * The menu button of a phone's header: what used to be two more rows (the languages, and the
 * links) is one tap away, so the header is one row and the screen is the page's. It drops from
 * the header and does not cover the hotline bar or the tabs: those stay reachable with it open
 * (safety rule 4). It closes on a tap anywhere else, on Escape and when the page changes - it
 * is open for one pathname only, so a link inside it needs no code to shut it.
 */
export function PhoneMenu({ hasAbout }: { hasAbout: boolean }) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const [openAt, setOpenAt] = useState<string | null>(null);
  const open = openAt === pathname;
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpenAt(null);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenAt(null);
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <div ref={box} className="sm:hidden">
      <button
        type="button"
        onClick={() => setOpenAt(open ? null : pathname)}
        aria-expanded={open}
        aria-controls="phone-menu"
        aria-label={open ? t("menuClose") : t("menu")}
        data-phone-menu-button
        className="inline-flex min-h-tap w-12 items-center justify-center rounded text-white"
      >
        {open ? <CrossIcon size={24} /> : <MenuIcon size={24} />}
      </button>
      {open ? (
        <div
          id="phone-menu"
          data-phone-menu
          className="absolute inset-x-0 top-full z-30 max-h-[60dvh] overflow-y-auto border-t border-white/15 bg-jaga-slate px-2 pb-3 shadow-lg"
        >
          <LanguageSwitcher />
          <ThemeSwitch withLabel />
          <ul className="flex flex-col items-start">
            <li className="w-full">
              <AccountLink menu />
            </li>
            <li>
              <AboutLink has={hasAbout} />
            </li>
            <li>
              <AdminLink />
            </li>
          </ul>
          <div className="flex min-h-tap items-center px-2 text-white">
            <ThaiClock label={t("clock")} size="small" />
          </div>
        </div>
      ) : null}
    </div>
  );
}
