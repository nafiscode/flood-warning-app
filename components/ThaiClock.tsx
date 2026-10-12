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
 * can see what "now" is on that scale. It is words and numbers only, and asks nothing of the
 * server: `useNow` moves on twice a minute. Until the page is alive in the browser it draws a
 * blank of the same width, so the server's HTML and the first paint agree.
 */
export function ThaiClock({
  short,
  long,
  size = "wide",
  className = "",
}: {
  /** The few letters that fit on a phone: "ไทย", "TH". */
  short: string;
  /** What it is, in full: "Thailand time". Shown on a wide screen and read to a screen reader. */
  long: string;
  size?: "wide" | "small";
  className?: string;
}) {
  const now = useNow();
  const time = now > 0 ? thaiTime(now) : "";
  return (
    <span
      data-clock={size}
      title={long}
      className={`whitespace-nowrap font-medium tabular-nums text-white ${
        size === "small" ? "text-[12px] leading-none" : "text-small"
      } ${className}`}
    >
      <span className="sr-only">{long} </span>
      <span aria-hidden="true">{size === "small" ? short : long} </span>
      {time || <span className="invisible">00:00</span>}
    </span>
  );
}
