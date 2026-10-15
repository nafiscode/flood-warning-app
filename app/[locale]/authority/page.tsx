import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { BackLink } from "@/components/BackLink";
import { Console } from "@/components/authority/Console";
import { Link } from "@/i18n/navigation";
import { readAuthorityBoard, readMyUnits } from "@/lib/authority-board";
import { getSessionProfile, localePath } from "@/lib/auth";
import { authorityMessages } from "@/lib/messages";
import { buttonSecondary, card } from "@/lib/ui";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/authority">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "authority" });
  return { title: t("title") };
}

/**
 * The authority console (spec section 5): the cases in a verified team's coverage, and the offer
 * that is ringing its phone. A visitor is sent to sign in; someone whose unit is not verified yet
 * is told so. That only decides what is drawn: the board function itself refuses anyone without a
 * verified unit, and every tap is checked again in the database (safety rule 5).
 */
export const dynamic = "force-dynamic";

export default async function AuthorityPage({ params }: PageProps<"/[locale]/authority">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await getSessionProfile();
  if (!session) {
    redirect(`${localePath(locale, "/sign-in")}?next=${localePath(locale, "/authority")}`);
  }
  const t = await getTranslations("authority");
  const units = await readMyUnits(session.userId);
  if (units.length === 0) {
    return (
      <section className={card}>
        <h1 className="text-h3 font-bold text-jaga-ink">{t("notVerified.title")}</h1>
        <p>{t("notVerified.body")}</p>
        <Link href="/account" className={buttonSecondary}>
          {t("notVerified.account")}
        </Link>
      </section>
    );
  }
  const board = await readAuthorityBoard(session.userId);
  const tField = await getTranslations("fieldRescue");
  return (
    <div className="flex flex-col gap-5">
      {/* For people the team found by itself, who never sent an SOS (the owner, 13-14 Oct). */}
      <Link
        href="/authority/field-rescue"
        className={buttonSecondary}
        data-field-rescue-link="true"
      >
        {tField("link")}
      </Link>
      <NextIntlClientProvider messages={authorityMessages(await getMessages())}>
        <Console initial={board} />
      </NextIntlClientProvider>
      <BackLink label={(await getTranslations("nav"))("backHome")} />
    </div>
  );
}
