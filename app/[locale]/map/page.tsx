import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { Dashboard } from "@/components/map/Dashboard";
import { donationsEnabled } from "@/lib/features";
import { mapMessages } from "@/lib/messages";

export async function generateMetadata({ params }: PageProps<"/[locale]/map">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "map" });
  return { title: t("title") };
}

/**
 * The map dashboard (spec 4.2). The Map tab always opens first; the Transparency tab is not
 * rendered at all until donations are switched on (safety rule 9, phase A11).
 */
export default async function MapPage({ params }: PageProps<"/[locale]/map">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <NextIntlClientProvider messages={mapMessages(await getMessages())}>
      <Dashboard transparency={donationsEnabled()} />
    </NextIntlClientProvider>
  );
}
