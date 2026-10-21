import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { HomeScreen } from "@/components/home/HomeScreen";
import { SiteJsonLd } from "@/components/seo/SiteJsonLd";
import { projectLine } from "@/lib/hotlines";
import { homeMessages } from "@/lib/messages";
import { EARLY_STATUS_SCRIPT } from "@/lib/public-status";
import { alternates } from "@/lib/seo";

/**
 * The title and the description are the layout's (app/[locale]/layout.tsx); what this adds is the
 * one address of the home page and where its other two languages are (lib/seo.ts).
 */
export async function generateMetadata({ params }: PageProps<"/[locale]">): Promise<Metadata> {
  const { locale } = await params;
  return { alternates: alternates(locale, "/") };
}

/**
 * Home (spec 4.1): the alert for the person's tambon, what to do, SOS, Report and safe places.
 * It never loads the map. The page is the same static HTML for everyone; the phone fills in the
 * area and the alert status (components/home/HomeScreen). The hotlines are in the shell below.
 */
export default async function Home({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <NextIntlClientProvider messages={homeMessages(await getMessages())}>
      <script dangerouslySetInnerHTML={{ __html: EARLY_STATUS_SCRIPT }} />
      {/* What Jaga is, for a search engine: free, three languages, four provinces and no others. */}
      <SiteJsonLd locale={locale} />
      <HomeScreen projectLine={projectLine()} />
    </NextIntlClientProvider>
  );
}
