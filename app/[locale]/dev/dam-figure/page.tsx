import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { DamFigureExample } from "@/components/dev/DamFigureExample";
import { Link } from "@/i18n/navigation";
import { devPagesEnabled } from "@/lib/dev-pages";
import { mapMessages } from "@/lib/messages";
import { hint } from "@/lib/ui";

export const metadata: Metadata = { robots: { index: false, follow: false } };
/*
 * Prerendering would bake the first scenario into the page and serve it for every `?s=`, which is
 * what happened to /dev/weather on 12 Oct. The figures are chosen by tapping, so this page is
 * rendered on the spot.
 */
export const dynamic = "force-dynamic";

/**
 * Three animated figures of the dam's state, side by side, for the owner to choose one (their
 * request of 12 Oct). Nothing here is on the home screen yet: this page is the choosing.
 * Development and preview only.
 */
export default async function DamFigurePage({ params }: PageProps<"/[locale]/dev/dam-figure">) {
  if (!devPagesEnabled()) notFound();
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("devHome");
  const messages = await getMessages();
  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-2">
        <h1 className="text-h3 font-bold">{t("damFigureTitle")}</h1>
        <p className={hint}>{t("damFigureNote")}</p>
        <Link href="/dev/dam" className="inline-flex min-h-tap items-center underline">
          {t("damTitle")}
        </Link>
      </header>
      <p className="rounded-xl border-2 border-dashed border-jaga-edge px-4 py-2 text-center font-bold">
        {t("example")}
      </p>
      <NextIntlClientProvider messages={{ ...mapMessages(messages), devHome: messages.devHome }}>
        <DamFigureExample />
      </NextIntlClientProvider>
    </div>
  );
}
