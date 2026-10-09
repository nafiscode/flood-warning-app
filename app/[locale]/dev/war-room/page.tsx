import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { WarRoomExample } from "@/components/dev/WarRoomExample";
import { Link } from "@/i18n/navigation";
import { devPagesEnabled } from "@/lib/dev-pages";
import { warRoomMessages } from "@/lib/messages";
import { hint } from "@/lib/ui";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * The admins' war room with made-up cases, people and reports, so it can be judged before there
 * is anything real in the database. Development and preview only (lib/dev-pages.ts); the real one
 * is /admin/war-room and nobody but an admin can open it.
 */
export default async function WarRoomExamplePage({ params }: PageProps<"/[locale]/dev/war-room">) {
  if (!devPagesEnabled()) notFound();
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("devHome");
  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-2">
        <h1 className="text-h3 font-bold">{t("warRoomTitle")}</h1>
        <p className={hint}>{t("note")}</p>
        <div className="flex flex-wrap gap-4">
          <Link href="/dev/home" className="inline-flex min-h-tap items-center underline">
            {t("title")}
          </Link>
          <Link href="/dev/map" className="inline-flex min-h-tap items-center underline">
            {t("mapTitle")}
          </Link>
        </div>
      </header>
      <p className="rounded-xl border-2 border-dashed border-jaga-edge px-4 py-2 text-center font-bold">
        {t("example")}
      </p>
      <NextIntlClientProvider messages={warRoomMessages(await getMessages())}>
        <WarRoomExample view="cases" />
      </NextIntlClientProvider>
    </div>
  );
}
