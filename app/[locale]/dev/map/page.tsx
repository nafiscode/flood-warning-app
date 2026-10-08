import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { MapExample } from "@/components/dev/Examples";
import { Link } from "@/i18n/navigation";
import { devPagesEnabled } from "@/lib/dev-pages";
import { mapMessages } from "@/lib/messages";
import { hint } from "@/lib/ui";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/** The map dashboard with made-up alerts, reports, places and a gauge. Development and preview only. */
export default async function MapExamplePage({ params }: PageProps<"/[locale]/dev/map">) {
  if (!devPagesEnabled()) notFound();
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("devHome");
  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-2">
        <h1 className="text-h3 font-bold">{t("mapTitle")}</h1>
        <p className={hint}>{t("note")}</p>
        <Link href="/dev/home" className="inline-flex min-h-tap items-center underline">
          {t("title")}
        </Link>
      </header>
      <p className="rounded-xl border-2 border-dashed border-jaga-slate px-4 py-2 text-center font-bold">
        {t("example")}
      </p>
      <NextIntlClientProvider messages={mapMessages(await getMessages())}>
        <MapExample />
      </NextIntlClientProvider>
    </div>
  );
}
