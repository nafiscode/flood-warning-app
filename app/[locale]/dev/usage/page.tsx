import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { Usage } from "@/components/admin/Usage";
import { devPagesEnabled } from "@/lib/dev-pages";
import { usageMessages } from "@/lib/messages";
import { exampleUsage } from "@/lib/usage-examples";
import { readWindow } from "@/lib/usage";

export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * The usage dashboard with made-up figures (development and preview only, lib/dev-pages.ts), so
 * the design can be judged before real phones have been counted. The real one is /admin/usage.
 */
export default async function UsageExamplePage({
  params,
  searchParams,
}: PageProps<"/[locale]/dev/usage">) {
  if (!devPagesEnabled()) notFound();
  const { locale } = await params;
  setRequestLocale(locale);
  const days = readWindow((await searchParams).days);
  const messages = await getMessages();
  return (
    <NextIntlClientProvider locale={locale} messages={usageMessages(messages)}>
      <Usage key={days} initial={exampleUsage(days)} days={days} locale={locale} example />
    </NextIntlClientProvider>
  );
}
