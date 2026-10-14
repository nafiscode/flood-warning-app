import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { Usage } from "@/components/admin/Usage";
import { isAdminHere } from "@/lib/admin-guard";
import { readUsage } from "@/lib/admin-usage";
import { usageMessages } from "@/lib/messages";
import { readWindow } from "@/lib/usage";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/admin/usage">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "usage" });
  return { title: t("title") };
}

export const dynamic = "force-dynamic";

/**
 * Who uses Jaga (the owner, 14 Oct): live, today, since the start, on a map, and how engaged.
 * The first read is made here so the page arrives filled; the page then refreshes itself every
 * 30 seconds through /api/admin/usage. Admins only: the layout turns everyone else away, and
 * admin_usage() refuses them again in the database.
 */
export default async function UsagePage({
  params,
  searchParams,
}: PageProps<"/[locale]/admin/usage">) {
  const { locale } = await params;
  setRequestLocale(locale);
  if (!(await isAdminHere())) return null;
  const days = readWindow((await searchParams).days);
  const [usage, messages] = await Promise.all([readUsage(days), getMessages()]);
  return (
    <NextIntlClientProvider locale={locale} messages={usageMessages(messages)}>
      <Usage key={days} initial={usage} days={days} locale={locale} />
    </NextIntlClientProvider>
  );
}
