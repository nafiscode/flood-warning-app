import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["th", "ms", "en"],
  defaultLocale: "th",
  // jagaapp.org/ is Thai; Malay and English live under /ms and /en (decisions, 2026-09-29).
  localePrefix: "as-needed",
  // No redirect based on the phone's language: the printed address always opens in Thai,
  // and every URL has one fixed language, so pages can be cached per URL during an alert burst.
  localeDetection: false,
});

export type Locale = (typeof routing.locales)[number];
