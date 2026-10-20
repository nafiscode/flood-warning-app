import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { About } from "@/components/about/About";

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
  return { title: t("title"), description: t("lead") };
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
