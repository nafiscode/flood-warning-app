"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { reveal } from "@/lib/reveal";

/** How far past the frozen header the map has to be before the way back is offered. */
const GONE_PX = 24;

/**
 * Back to the map, on a phone (the owner, 20 Oct 2026, option C). With the map at the top of the
 * page, somebody who has scrolled down to read the key or the live readings is a long way from
 * the thing they came for, and the only way back was to scroll by hand.
 *
 * Drawn only while the map has left the top of the screen. It rides above the hotline bar, which
 * is sticky at the foot of every screen (app/globals.css, the phone block): the four numbers are
 * always one tap away, so nothing is ever drawn over them.
 */
export function BackToMap() {
  const t = useTranslations("map.phone");
  const [show, setShow] = useState(false);
  useEffect(() => {
    let frame = 0;
    const check = () => {
      frame = 0;
      const map = document.querySelector("[data-map-frame]")?.getBoundingClientRect();
      const header = document.querySelector("header")?.getBoundingClientRect().height ?? 0;
      setShow(map !== undefined && map.bottom < header + GONE_PX);
    };
    const later = () => {
      if (!frame) frame = window.requestAnimationFrame(check);
    };
    later();
    window.addEventListener("scroll", later, { passive: true });
    window.addEventListener("resize", later);
    return () => {
      window.removeEventListener("scroll", later);
      window.removeEventListener("resize", later);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);
  if (!show) return null;
  return (
    <button
      type="button"
      data-back-to-map="true"
      onClick={() =>
        reveal(() => document.querySelector<HTMLElement>("[data-map-frame]"), {
          mark: false,
          focus: false,
        })
      }
      className="inline-flex min-h-tap items-center gap-1.5 rounded-full border border-jaga-line bg-jaga-slate px-4 font-medium text-white shadow-lg"
    >
      <svg
        viewBox="0 0 20 20"
        aria-hidden="true"
        className="size-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M10 15.5V5M5 9.5l5-5 5 5" />
      </svg>
      {t("back")}
    </button>
  );
}
