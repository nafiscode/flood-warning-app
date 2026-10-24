import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ImpactSoon } from "@/components/impact/ImpactSoon";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/admin/impact">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "impactPublic" });
  return { title: t("title") };
}

/**
 * The impact record inside the admin console (spec section 16). It used to show a made-up season
 * to admins only; since 24 Oct 2026 it shows what visitors see at /impact, which has no figures
 * until the nightly aggregates of A13 exist. The invented season lives on in lib/impact-examples.ts
 * and is reviewable at /dev/impact (development and preview only). When A13 lands, this page reads
 * impact_daily and impact_unit_totals instead.
 *
 * The layout above has already turned away everyone who is not an admin.
 */
export default async function AdminImpact({ params }: PageProps<"/[locale]/admin/impact">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <ImpactSoon />;
}
