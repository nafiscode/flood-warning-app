import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ImpactSoon } from "@/components/impact/ImpactSoon";
import { alternates } from "@/lib/seo";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/impact">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "impactPublic" });
  return {
    title: t("title"),
    description: t("lead"),
    alternates: alternates(locale, "/impact"),
  };
}

/**
 * The public impact record (spec section 16): open to everyone, no account, the same page for
 * every visitor. Until A13 builds the nightly aggregates there is nothing real to count, so it
 * shows no figures at all and says so. When A13 lands, this page reads impact_daily and
 * impact_unit_totals and renders the dashboard in place of `ImpactSoon`.
 */
export default async function ImpactPage({ params }: PageProps<"/[locale]/impact">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <ImpactSoon />;
}
