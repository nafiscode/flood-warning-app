import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { InstallExample } from "@/components/dev/InstallExample";
import { Link } from "@/i18n/navigation";
import { devPagesEnabled } from "@/lib/dev-pages";
import { installMessages } from "@/lib/messages";
import { hint } from "@/lib/ui";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * The "put Jaga on your home screen" guide for every kind of device side by side (development
 * and preview only, lib/dev-pages.ts). On the real screens a person sees only their own.
 */
export default async function InstallExamplePage({ params }: PageProps<"/[locale]/dev/install">) {
  if (!devPagesEnabled()) notFound();
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("devHome");
  const all = await getMessages();
  const dev = all.devHome as Record<string, unknown>;
  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-2">
        <h1 className="text-h3 font-bold">{t("installTitle")}</h1>
        <p className={hint}>{t("installNote")}</p>
        <Link href="/dev/home" className="inline-flex min-h-tap items-center underline">
          {t("title")}
        </Link>
      </header>
      <NextIntlClientProvider
        messages={{
          ...installMessages(all),
          devHome: { installGuide: dev.installGuide as Record<string, string> },
        }}
      >
        <InstallExample />
      </NextIntlClientProvider>
    </div>
  );
}
