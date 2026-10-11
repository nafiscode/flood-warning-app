import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { AuthorityExample } from "@/components/dev/AuthorityExample";
import { Link } from "@/i18n/navigation";
import { devPagesEnabled } from "@/lib/dev-pages";
import { authorityMessages } from "@/lib/messages";
import { hint } from "@/lib/ui";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * The authority console with made-up cases, so it can be judged - and its alarm heard - before
 * any team is verified. Development and preview only (lib/dev-pages.ts); the real one is
 * /authority and only a verified team can open it.
 */
export default async function AuthorityExamplePage({
  params,
}: PageProps<"/[locale]/dev/authority">) {
  if (!devPagesEnabled()) notFound();
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("devHome");
  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-2">
        <h1 className="text-h3 font-bold">{t("authorityTitle")}</h1>
        <p className={hint}>{t("authorityNote")}</p>
        <div className="flex flex-wrap gap-4">
          <Link href="/dev/home" className="inline-flex min-h-tap items-center underline">
            {t("title")}
          </Link>
          <Link href="/dev/war-room" className="inline-flex min-h-tap items-center underline">
            {t("warRoomTitle")}
          </Link>
        </div>
      </header>
      <p className="rounded-xl border-2 border-dashed border-jaga-edge px-4 py-2 text-center font-bold">
        {t("example")}
      </p>
      <NextIntlClientProvider messages={authorityMessages(await getMessages())}>
        <AuthorityExample />
      </NextIntlClientProvider>
    </div>
  );
}
