import { NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { HomeScreen } from "@/components/home/HomeScreen";
import { projectLine } from "@/lib/hotlines";
import { homeMessages } from "@/lib/messages";
import { EARLY_STATUS_SCRIPT } from "@/lib/public-status";

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
      <HomeScreen projectLine={projectLine()} />
    </NextIntlClientProvider>
  );
}
