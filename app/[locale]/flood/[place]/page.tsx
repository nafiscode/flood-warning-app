import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { FloodPlace } from "@/components/flood/FloodPlace";
import {
  districtNames,
  isPlaceSlug,
  PLACE_SLUGS,
  PLACES,
  PROVINCE_SLUGS,
  readPlace,
} from "@/lib/flood-places";
import { alternates } from "@/lib/seo";

/**
 * A flood page per place (A10, 21 Oct 2026), at /flood/<place>: the four covered provinces and the
 * districts people search by name (lib/flood-places.ts).
 *
 * Why they exist: measured on 21 October, jagaapp.org did not appear in a search for its own name,
 * let alone for "น้ำท่วมปัตตานี" or "น้ำท่วมหาดใหญ่". The map is drawn in the browser, so until now
 * no page anywhere on the site had a place name in its text for a search engine to read. These are
 * that page - and they are useful in their own right to somebody arriving cold, since they work
 * with no JavaScript and say what to do before they say anything else.
 *
 * The slug is Roman ("hat-yai") rather than Thai: one address then works in all three languages
 * and survives being pasted into a LINE message, and next-intl gives each language its own prefix
 * above it (/flood/hat-yai, /ms/flood/hat-yai, /en/flood/hat-yai).
 */

/** The four provinces' names, which live in `messages/` like any other text. */
async function provinceNames(locale: string): Promise<Record<string, string>> {
  const t = await getTranslations({ locale, namespace: "authority.coverage.province" });
  return Object.fromEntries(PROVINCE_SLUGS.map((slug) => [slug, t(PLACES[slug]!.code as never)]));
}

/**
 * How the page names this place, and what it offers at the foot.
 *
 * A province is "จ.ปัตตานี" and offers the other three provinces. A district is "อ.หาดใหญ่ จ.สงขลา"
 * and offers its province first, then the other districts of that province that have a page.
 */
async function label(locale: string, slug: string) {
  const place = PLACES[slug]!;
  const t = await getTranslations({ locale, namespace: "province.place" });
  const provinces = await provinceNames(locale);
  const provinceSlug = PROVINCE_SLUGS.find((other) => PLACES[other]!.code === place.code.slice(0, 2));
  const provinceName = provinceSlug ? provinces[provinceSlug]! : "";

  if (place.kind === "province") {
    return {
      name: t("province", { name: provinceName }),
      province: null,
      siblings: PROVINCE_SLUGS.filter((other) => other !== slug).map((other) => ({
        slug: other,
        name: t("province", { name: provinces[other]! }),
      })),
    };
  }

  // Every other district with a page that sits in the same province.
  const neighbourSlugs = PLACE_SLUGS.filter(
    (other) =>
      other !== slug &&
      PLACES[other]!.kind === "district" &&
      PLACES[other]!.code.startsWith(place.code.slice(0, 2)),
  );
  // This district and its neighbours in one read, not one read each.
  const names = await districtNames(
    [place.code, ...neighbourSlugs.map((other) => PLACES[other]!.code)],
    locale,
  );
  const own = names[place.code] ?? place.code;
  const neighbours = neighbourSlugs.map((other) => ({
    slug: other,
    name: names[PLACES[other]!.code] ?? other,
  }));
  return {
    name: t("district", { name: own, province: provinceName }),
    province: provinceSlug
      ? { slug: provinceSlug, name: t("province", { name: provinceName }) }
      : null,
    siblings: neighbours,
  };
}

export function generateStaticParams() {
  return PLACE_SLUGS.map((place) => ({ place }));
}

/**
 * Read afresh for every visit, and kept at the edge for 60 s - the same window the public
 * endpoints use (lib/supabase/public.ts), so a burst of people arriving after an alert costs one
 * database read between them. The page prints the time its data is from either way, so a reader is
 * never left guessing how old a level is.
 */
export const revalidate = 60;

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/flood/[place]">): Promise<Metadata> {
  const { locale, place } = await params;
  if (!isPlaceSlug(place)) return {};
  const t = await getTranslations({ locale, namespace: "province" });
  const { name } = await label(locale, place);
  return {
    title: t("title", { place: name }),
    description: t("lead", { place: name }),
    alternates: alternates(locale, `/flood/${place}`),
  };
}

export default async function FloodPlacePage({ params }: PageProps<"/[locale]/flood/[place]">) {
  const { locale, place } = await params;
  if (!isPlaceSlug(place)) notFound();
  setRequestLocale(locale);
  const [view, named] = await Promise.all([readPlace(place), label(locale, place)]);
  return (
    <FloodPlace
      view={view}
      name={named.name}
      province={named.province}
      siblings={named.siblings}
    />
  );
}
