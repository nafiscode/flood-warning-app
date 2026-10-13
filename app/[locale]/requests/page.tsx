import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { MyRequests } from "@/components/journey/MyRequests";
import { journeyMessages } from "@/lib/journey-messages";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/requests">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "journey" });
  return { title: t("page.title") };
}

/**
 * "My requests" (the owner, 13 Oct): one place to see where everything a person has sent stands
 * - requests for help, requests for food and water, a team's registration, flood reports - each
 * as a line of steps. The page itself knows nothing and is the same for everyone: what is shown
 * is read in the browser, a request for help with the key the phone holds for it, so it works
 * for someone without an account, and the page can be cached and opened offline like any other.
 */
export default async function RequestsPage({ params }: PageProps<"/[locale]/requests">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <NextIntlClientProvider messages={journeyMessages(await getMessages())}>
      <MyRequests />
    </NextIntlClientProvider>
  );
}
