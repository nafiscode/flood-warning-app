"use client";

import { useNow } from "@/lib/use-public";

const HOUR_MINUTE = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Bangkok",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** "14:05" in Thailand, whatever the clock of the phone or laptop says. */
export function thaiTime(now: number): string {
  return HOUR_MINUTE.format(new Date(now));
}

/**
 * The time in the service area, in the header (the owner, 13 Oct). Every time Jaga shows - an
 * alert's issue time, a reading's age - is Thailand's, so someone abroad, or with a wrong clock,
 * can see what "now" is on that scale. It is the number alone: the people Jaga is for are in
 * Thailand and know whose time it is (the owner, 13 Oct), so the word is kept only for a screen
 * reader and the tooltip, where a bare "14:05" would say nothing. It asks nothing of the server:
 * `useNow` moves on twice a minute. Until the page is alive in the browser it draws a blank of
 * the same width, so the server's HTML and the first paint agree.
 */
export function ThaiClock({
  label,
  size = "wide",
  className = "",
}: {
  /** What the number is, for a screen reader and the tooltip only: "Time". */
  label: string;
  size?: "wide" | "small";
  className?: string;
}) {
  const now = useNow();
  const time = now > 0 ? thaiTime(now) : "";
  return (
    <span
      data-clock={size}
      title={label}
      className={`whitespace-nowrap font-medium tabular-nums text-white ${
        size === "small" ? "text-[12px] leading-none" : "text-small"
      } ${className}`}
    >
      <span className="sr-only">{label} </span>
      {time || <span className="invisible">00:00</span>}
    </span>
  );
}
