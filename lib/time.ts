/** "20 Nov 14:00": 24-hour clock in Bangkok time for every reader (decision 2026-09-29). */
export const BANGKOK_DATE_TIME = {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "Asia/Bangkok",
} as const satisfies Intl.DateTimeFormatOptions;

/** "14 Oct": a day with no clock time, for a reservoir whose figures come once a day. */
export const BANGKOK_DAY = {
  day: "numeric",
  month: "short",
  timeZone: "Asia/Bangkok",
} as const satisfies Intl.DateTimeFormatOptions;
