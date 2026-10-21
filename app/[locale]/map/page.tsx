import type { Metadata } from "next";
import { Suspense } from "react";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { Dashboard } from "@/components/map/Dashboard";
import { SeasonOutlook } from "@/components/map/SeasonOutlook";
import { donationsEnabled } from "@/lib/features";
import { mapMessages } from "@/lib/messages";
import { alternates } from "@/lib/seo";

export async function generateMetadata({ params }: PageProps<"/[locale]/map">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "map" });
  return { title: t("title"), alternates: alternates(locale, "/map") };
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
      {/*
       * The dashboard reads "?dam=" from the address (the home screen's button into the dam's
       * report), and a component that reads the address needs a boundary around it for this page
       * to stay prerendered - which the offline shell depends on (safety rule 7).
       */}
      <Suspense>
        <Dashboard transparency={donationsEnabled()} />
      </Suspense>
      {/*
       * The season outlook (science plan Module 9; the owner chose to show it, 14 Oct 2026): below
       * the map and its legend, closed until opened, and nowhere else - never on the home screen
       * or beside an alert level.
       */}
      <SeasonOutlook />
    </NextIntlClientProvider>
  );
}
