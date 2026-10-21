import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { HowScience } from "@/components/how/HowScience";
import { alternates } from "@/lib/seo";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/how-it-works">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "howItWorks.science" });
  /*
   * The description names the data this page explains, using the credits line the map already
   * carries. Two reasons, and neither is a keyword trick. It is the attribution the sources are
   * owed, said in the one line a search engine quotes back; and somebody searching for one of them
   * next to a flood - "แผนที่น้ำท่วมซ้ำซาก GISTDA" - is looking for exactly this page, which names
   * GISTDA eighteen times in its text and could not be found at all until today.
   *
   * It stops at attribution on a methods page. Jaga does not put an agency's name in its own title
   * or claim its authority: the search for "GISTDA" belongs to GISTDA.
   */
  const sources = await getTranslations({ locale, namespace: "mapMethod" });
  return {
    title: t("title"),
    description: `${t("lead")} ${sources("credits")}`,
    alternates: alternates(locale, "/how-it-works"),
  };
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
