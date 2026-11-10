import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { FAQ_KEYS, FloodHub } from "@/components/flood/FloodHub";
import { districtNames, PLACES, PLACE_SLUGS, PROVINCE_SLUGS } from "@/lib/flood-places";
import { alternates, localeHref } from "@/lib/seo";
import { siteUrl } from "@/lib/site";

/**
 * The hub at /flood (A10, 10 Nov 2026), the page for somebody searching for a flood app rather
 * than for a place.
 *
 * The place pages under it have answered "น้ำท่วมปัตตานี" since 21 October. What no page answered was
 * the general question - แอปน้ำท่วม, แอปน้ำท่วมภาคใต้, น้ำท่วม 3 จังหวัด - which left the home screen to carry
 * it, and the home screen has a different job: it is what somebody opens during a flood, not a
 * description of the service. So this page says what Jaga is, who it covers and what it cannot
 * do, and hands the reader on to their own place.
 *
 * It takes no live reading and renders the same for everyone, so it is static: it caches at the
 * edge, opens on a failing connection, and there is nothing on it that could leak.
 */

export const dynamic = "force-static";

/** The four provinces' names, from `messages/` like every other string. */
async function provinceLinks(locale: string) {
  const t = await getTranslations({ locale, namespace: "authority.coverage.province" });
  const tPlace = await getTranslations({ locale, namespace: "province.place" });
  return PROVINCE_SLUGS.map((slug) => ({
    slug,
    name: tPlace("province", { name: t(PLACES[slug]!.code as never) }),
  }));
}

/** The districts that have a page of their own, named in the reader's language. */
async function districtLinks(locale: string) {
  const slugs = PLACE_SLUGS.filter((slug) => PLACES[slug]!.kind === "district");
  const names = await districtNames(
    slugs.map((slug) => PLACES[slug]!.code),
    locale,
  );
  return slugs.map((slug) => ({ slug, name: names[PLACES[slug]!.code] ?? slug }));
}

export async function generateMetadata({
  params,
}: LayoutProps<"/[locale]">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "floodHub" });
  return {
    title: t("title"),
    description: t("description"),
    alternates: alternates(locale, "/flood"),
  };
}

export default async function FloodHubPage({ params }: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "floodHub" });
  const [provinces, districts] = await Promise.all([
    provinceLinks(locale),
    districtLinks(locale),
  ]);

  /*
   * The same questions the page prints, written for a machine. Built from FAQ_KEYS rather than
   * typed out again, so the structured data cannot come to say something the page does not.
   */
  const faq = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "@id": `${new URL(localeHref(locale, "/flood"), siteUrl()).toString()}#faq`,
    inLanguage: locale,
    mainEntity: FAQ_KEYS.map((key) => ({
      "@type": "Question",
      name: t(`faq.${key}Q`),
      acceptedAnswer: { "@type": "Answer", text: t(`faq.${key}A`) },
    })),
  };

  return (
    <>
      <script
        type="application/ld+json"
        // Built here from message files, not from anything a visitor sent.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faq) }}
      />
      <FloodHub provinces={provinces} districts={districts} />
    </>
  );
}
