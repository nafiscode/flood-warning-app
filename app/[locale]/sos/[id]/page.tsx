import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { CaseStatus } from "@/components/sos/CaseStatus";
import { sosMessages } from "@/lib/messages";
import { PRIVATE_PAGE } from "@/lib/seo";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/sos/[id]">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "sos" });
  return { title: t("status.title"), ...PRIVATE_PAGE };
}

/**
 * One request, for the person who sent it (spec 4.6). The page itself knows nothing: the case is
 * read in the browser with the token kept on the phone, so an anonymous sender can follow their
 * own case and nobody else's, and so the page can be cached like any other.
 */
export default async function SosCasePage({
  params,
  searchParams,
}: PageProps<"/[locale]/sos/[id]">) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const { merged } = await searchParams;
  return (
    <NextIntlClientProvider messages={sosMessages(await getMessages())}>
      <CaseStatus id={id} merged={merged === "1"} />
    </NextIntlClientProvider>
  );
}
