import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { HowScience } from "@/components/how/HowScience";
import { alternates } from "@/lib/seo";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/how-it-works">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "howItWorks.science" });
  return { title: t("title"), description: t("lead"), alternates: alternates(locale, "/how-it-works") };
}

/**
 * "How Jaga works: the science" (A18): open to everyone, no account, the same page for every
 * visitor. Everything on it is drawn in the page - no pictures to download - and nothing runs in
 * the browser, so it costs one small HTML file on a slow connection.
 */
export default async function HowItWorksPage({ params }: PageProps<"/[locale]/how-it-works">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <HowScience />;
}
