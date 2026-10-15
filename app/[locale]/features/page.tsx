import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Capabilities } from "@/components/capabilities/Capabilities";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/features">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "capabilities" });
  return { title: t("title"), description: t("lead") };
}

/**
 * "What Jaga can do" (A17): open to everyone, no account, the same static page for every visitor.
 * Everything on it is drawn in the page (no pictures to download), so it is light on slow 3G;
 * only the role picker runs in the browser.
 */
export default async function FeaturesPage({ params }: PageProps<"/[locale]/features">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <Capabilities />;
}
