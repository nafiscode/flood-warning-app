import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import en from "@/messages/en.json";
import ms from "@/messages/ms.json";
import th from "@/messages/th.json";

// All three of Jaga's locales: Malay is a first-class one, not an afterthought, so a test must be
// able to render it. Added 24 Nov 2026 - `flood-scene-render` loops over th/ms/en and the helper
// accepted only th/en, which put a type error on main and would have failed the next Vercel build.
const MESSAGES = { th, ms, en } as const;

/** Render with next-intl, in Thai by default (the source language). */
export function renderWithIntl(ui: ReactNode, locale: keyof typeof MESSAGES = "th") {
  return render(
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]} timeZone="Asia/Bangkok">
      {ui}
    </NextIntlClientProvider>,
  );
}
