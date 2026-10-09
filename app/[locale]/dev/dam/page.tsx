import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { DamExample } from "@/components/dev/Examples";
import { Link } from "@/i18n/navigation";
import { devPagesEnabled } from "@/lib/dev-pages";
import { mapMessages } from "@/lib/messages";
import { hint } from "@/lib/ui";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * The dam in each state it can be in (spec section 15). The river and the reservoir are the real
 * ones; only the figures are made up, because a release happens in a handful of hours a year and
 * the quiet notice should be read long before one does. Development and preview only.
 */
export default async function DamExamplePage({ params }: PageProps<"/[locale]/dev/dam">) {
  if (!devPagesEnabled()) notFound();
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("devHome");
  const messages = await getMessages();
  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-2">
        <h1 className="text-h3 font-bold">{t("damTitle")}</h1>
        <p className={hint}>{t("damNote")}</p>
        <Link href="/dev/map" className="inline-flex min-h-tap items-center underline">
          {t("mapTitle")}
        </Link>
      </header>
      <p className="rounded-xl border-2 border-dashed border-jaga-edge px-4 py-2 text-center font-bold">
        {t("example")}
      </p>
      {/* The scenario switcher is drawn in the browser, so its own words go with it. */}
      <NextIntlClientProvider messages={{ ...mapMessages(messages), devHome: messages.devHome }}>
        <DamExample />
      </NextIntlClientProvider>
    </div>
  );
}
