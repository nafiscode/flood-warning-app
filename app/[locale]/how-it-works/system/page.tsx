import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { HowSystem } from "@/components/how/HowSystem";
import { alternates } from "@/lib/seo";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/how-it-works/system">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "howItWorks.system" });
  return { title: t("title"), description: t("lead"), alternates: alternates(locale, "/how-it-works/system") };
}

/**
 * "How Jaga works: the system" (A18): the app as a concept, in general terms only. No vendor,
 * product or brand name appears on it, by design and by test (lib/how-it-works.ts).
 */
export default async function HowSystemPage({
  params,
}: PageProps<"/[locale]/how-it-works/system">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <HowSystem />;
}
