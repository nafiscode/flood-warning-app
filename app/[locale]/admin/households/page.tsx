import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { AdminHouseholds } from "@/components/admin/AdminHouseholds";
import { readAdminHouseholds } from "@/lib/admin-board";
import { authorityMessages } from "@/lib/messages";
import { hint } from "@/lib/ui";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/admin/households">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "admin" });
  return { title: t("households.title") };
}

export const dynamic = "force-dynamic";

/**
 * Every household that asked to be known about before a flood (spec 4.7), for admins. Opening
 * this page is itself a logged read of health information, which is why it is its own page and
 * not a panel that loads with something else. The layout has turned away everyone who is not an
 * admin; the database function checks again and writes the read to the access log.
 */
export default async function AdminHouseholdsPage({
  params,
}: PageProps<"/[locale]/admin/households">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("admin");
  const households = await readAdminHouseholds();
  return (
    <div className="flex flex-col gap-5" data-admin-households={households.length}>
      <h1 className="text-h3 font-bold text-jaga-ink">{t("households.title")}</h1>
      <p className={hint}>{t("households.intro", { count: households.length })}</p>
      <NextIntlClientProvider messages={authorityMessages(await getMessages())}>
        <AdminHouseholds households={households} />
      </NextIntlClientProvider>
    </div>
  );
}
