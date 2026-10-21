import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { About } from "@/components/about/About";
import { alternates } from "@/lib/seo";
import { OG_LOCALE, siteUrl } from "@/lib/site";

/**
 * The card a chat app shows for this page. The layout gives every page Jaga's own picture, which
 * is right for every page but this one: a link to "Who built Jaga" that shows the app's logo
 * tells the reader nothing about what they are being sent (the owner, 20 Oct 2026). So this page
 * carries its own, drawn from the same content the page is (`.claude/local/og-about.mjs`).
 *
 * It is fetched into `public/about/` with the rest of that content and is not in this repository.
 */
const SHARE = { url: "/about/share.jpg", width: 1200, height: 630 } as const;

/**
 * Whether this page has anything to show. Its content is not in this repository (the owner,
 * 20 Oct 2026): the build fetches it into `messages/about/`, so a fork, or a build that could not
 * reach the bucket, has no `about` namespace at all. Rather than render a page of missing keys,
 * the route takes itself out of existence.
 */
async function hasContent(locale: string): Promise<boolean> {
  const messages = (await getMessages({ locale })) as { about?: unknown };
  return Boolean(messages.about);
}

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/about">): Promise<Metadata> {
  const { locale } = await params;
  if (!(await hasContent(locale))) return {};
  const t = await getTranslations({ locale, namespace: "about" });
  const title = t("title");
  const description = t("audience");
  const url = new URL(locale === "th" ? "/about" : `/${locale}/about`, siteUrl()).toString();
  const images = [{ ...SHARE, alt: `${title} – ${t("name")}` }];
  return {
    title,
    description,
    alternates: alternates(locale, "/about"),
    // Spelled out rather than inherited: the layout's card is the app's, and this page is not.
    openGraph: {
      type: "profile",
      siteName: "Jaga",
      title,
      description,
      url,
      locale: OG_LOCALE[locale] ?? "th_TH",
      images,
    },
    twitter: { card: "summary_large_image", title, description, images: [SHARE.url] },
  };
}

/**
 * "Who built Jaga" (the owner's request of 20 Oct 2026, approved the same day): the founder and
 * developer, for the reader who wants to know whether a one-person flood-warning app can be
 * trusted, and for the reader who knows him and has never seen the professional side.
 *
 * Open to everyone, no account, the same page for every visitor. Nothing runs in the browser and
 * the only thing downloaded is the portrait and three small marks, so it costs about one HTML
 * file on a slow connection - which matters, because the people this page is for often arrive
 * from a link on a cheap phone.
 */
export default async function AboutPage({ params }: PageProps<"/[locale]/about">) {
  const { locale } = await params;
  setRequestLocale(locale);
  if (!(await hasContent(locale))) notFound();
  return <About />;
}
