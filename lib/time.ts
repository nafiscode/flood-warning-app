/** "20 Nov 14:00": 24-hour clock in Bangkok time for every reader (decision 2026-09-29). */
export const BANGKOK_DATE_TIME = {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "Asia/Bangkok",
} as const satisfies Intl.DateTimeFormatOptions;
