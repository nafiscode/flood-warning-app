import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { Impact } from "@/components/admin/Impact";
import { Link } from "@/i18n/navigation";
import { devPagesEnabled } from "@/lib/dev-pages";
import { EXAMPLE_IMPACT } from "@/lib/impact-examples";
import { impactMessages } from "@/lib/messages";
import { hint } from "@/lib/ui";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * The impact dashboard with made-up figures, reviewable without signing in as an admin
 * (development and preview only, lib/dev-pages.ts). /admin/impact shows the same screen from the
 * same example data until A13 builds the nightly aggregates; then the real page reads those and
 * this one keeps the example, like every other /dev page.
 */
export default async function ImpactExamplePage({ params }: PageProps<"/[locale]/dev/impact">) {
  if (!devPagesEnabled()) notFound();
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("devHome");
  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-2">
        <h1 className="text-h3 font-bold">{t("impactTitle")}</h1>
        <p className={hint}>{t("note")}</p>
        <div className="flex flex-wrap gap-4">
          <Link href="/dev/home" className="inline-flex min-h-tap items-center underline">
            {t("title")}
          </Link>
          <Link href="/dev/war-room" className="inline-flex min-h-tap items-center underline">
            {t("warRoomTitle")}
          </Link>
        </div>
      </header>
      <NextIntlClientProvider messages={impactMessages(await getMessages())}>
        <Impact season={EXAMPLE_IMPACT} locale={locale} />
      </NextIntlClientProvider>
    </div>
  );
}
