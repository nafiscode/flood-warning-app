import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { BackLink } from "@/components/BackLink";
import { MyCases } from "@/components/authority/MyCases";
import { getSessionProfile, localePath } from "@/lib/auth";
import { readMyWork } from "@/lib/field-crew";
import { fieldCrewMessages } from "@/lib/messages";
import { PRIVATE_PAGE } from "@/lib/seo";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/authority/mine">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "fieldCrew" });
  return { title: t("title"), ...PRIVATE_PAGE };
}

export const dynamic = "force-dynamic";

/**
 * "My cases" (24 Oct 2026): the page a crew member keeps open on site. A visitor is sent to sign
 * in; someone with nothing handed to them is told so. That only decides what is drawn: every read
 * and every tap is a database function that checks the assignment again (safety rule 5).
 */
export default async function MyCasesPage({ params }: PageProps<"/[locale]/authority/mine">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await getSessionProfile();
  if (!session) {
    redirect(`${localePath(locale, "/sign-in")}?next=${localePath(locale, "/authority/mine")}`);
  }
  const t = await getTranslations("fieldCrew");
  const work = await readMyWork().catch(() => ({ cases: [], open: [], readAt: "" }));
  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-h2 font-bold text-jaga-ink">{t("title")}</h1>
      <p>{t("intro")}</p>
      <NextIntlClientProvider messages={fieldCrewMessages(await getMessages())}>
        <MyCases initial={work} />
      </NextIntlClientProvider>
      <BackLink label={(await getTranslations("nav"))("backHome")} />
    </div>
  );
}
