import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { Impact } from "@/components/admin/Impact";
import { EXAMPLE_IMPACT } from "@/lib/impact-examples";
import { impactMessages } from "@/lib/messages";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/admin/impact">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "impact" });
  return { title: `${t("title")} — ${t("example.tag")}` };
}

/**
 * The impact dashboard (spec section 16), admin-only until A13 (owner, 9 Oct: build it now with
 * made-up data so the design can be judged before the first season).
 *
 * The layout above has already turned away everyone who is not an admin. There is deliberately
 * no data access here: the nightly aggregates of A13 do not exist yet, so the page is fed from
 * lib/impact-examples.ts and says in its first block that every figure is invented. When A13
 * lands, this page reads impact_daily and impact_unit_totals instead, and the example stays
 * behind the /dev pages like every other example (decision of 8 Oct).
 */
export default async function AdminImpact({ params }: PageProps<"/[locale]/admin/impact">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const messages = await getMessages();
  return (
    <NextIntlClientProvider locale={locale} messages={impactMessages(messages)}>
      <Impact season={EXAMPLE_IMPACT} locale={locale} />
    </NextIntlClientProvider>
  );
}
