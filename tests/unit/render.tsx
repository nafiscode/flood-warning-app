import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import en from "@/messages/en.json";
import th from "@/messages/th.json";

const MESSAGES = { th, en } as const;

/** Render with next-intl, in Thai by default (the source language). */
export function renderWithIntl(ui: ReactNode, locale: keyof typeof MESSAGES = "th") {
  return render(
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]} timeZone="Asia/Bangkok">
      {ui}
    </NextIntlClientProvider>,
  );
}
