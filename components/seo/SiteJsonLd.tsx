import { getTranslations } from "next-intl/server";
import { PROVINCES } from "@/lib/coverage";
import { localeHref } from "@/lib/seo";
import { siteUrl } from "@/lib/site";

/**
 * What Jaga is, written for a machine (schema.org JSON-LD), on the home page only.
 *
 * A search engine reading the home page can tell that this is a page about floods; what it cannot
 * tell from the words alone is that Jaga is one non-profit service, free, in three languages, for
 * four named provinces and no others. That last part is the reason this is here rather than a
 * nice-to-have: a reader in a province Jaga does not cover should not be sent here by a search
 * (safety rule 10), and `areaServed` is the only way to say so in a form a crawler acts on.
 *
 * Every string is read from `messages/` like any other text - nothing here is written in English
 * in the code - and nothing personal is in it: no phone number, no address, no person's name.
 */
export async function SiteJsonLd({ locale }: { locale: string }) {
  const t = await getTranslations({ locale, namespace: "app" });
  const tProvince = await getTranslations({ locale, namespace: "authority.coverage.province" });
  const base = siteUrl();
  const home = new URL(localeHref(locale, "/"), base).toString();

  const areaServed = PROVINCES.map((code) => ({
    "@type": "AdministrativeArea",
    name: tProvince(code as never),
    identifier: code,
    containedInPlace: { "@type": "Country", name: "Thailand" },
  }));

  const graph = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "NGO",
        "@id": `${base}/#organization`,
        name: t("name"),
        alternateName: t("nameThai"),
        slogan: t("tagline"),
        description: t("description"),
        url: base,
        logo: new URL("/icons/icon-512.png", base).toString(),
        areaServed,
      },
      {
        "@type": "WebSite",
        "@id": `${base}/#website`,
        name: t("pwaName"),
        description: t("description"),
        url: home,
        inLanguage: locale,
        publisher: { "@id": `${base}/#organization` },
      },
      {
        "@type": "WebApplication",
        "@id": `${base}/#app`,
        name: t("pwaName"),
        alternateName: t("nameThai"),
        description: t("description"),
        url: home,
        // The app runs in a browser and installs from it: no store listing to point at.
        applicationCategory: "UtilitiesApplication",
        operatingSystem: "Any",
        browserRequirements: "Requires JavaScript",
        inLanguage: ["th", "ms", "en"],
        isAccessibleForFree: true,
        // Said in the one form a search result will repeat: Jaga costs nothing to use.
        offers: { "@type": "Offer", price: "0", priceCurrency: "THB" },
        areaServed,
        publisher: { "@id": `${base}/#organization` },
      },
    ],
  };

  return (
    <script
      type="application/ld+json"
      // The object is built here from message files, not from anything a visitor sent.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(graph) }}
    />
  );
}
