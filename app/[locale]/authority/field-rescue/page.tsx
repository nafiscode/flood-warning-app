import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { BackLink } from "@/components/BackLink";
import { FieldRescue } from "@/components/authority/FieldRescue";
import { Link } from "@/i18n/navigation";
import { getSessionProfile, localePath } from "@/lib/auth";
import { readMyUnits } from "@/lib/authority-board";
import { fieldRescueMessages } from "@/lib/field-rescue";
import { buttonSecondary, card } from "@/lib/ui";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/authority/field-rescue">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "fieldRescue" });
  return { title: t("title") };
}

export const dynamic = "force-dynamic";

/**
 * "Record a rescue we did": for a verified team, about people it found and helped who never
 * sent an SOS (the owner, 13-14 Oct). A visitor is sent to sign in and a team that is not
 * verified is told so; that only decides what is drawn - the database function refuses anyone
 * without a verified team (safety rule 5).
 */
export default async function FieldRescuePage({
  params,
}: PageProps<"/[locale]/authority/field-rescue">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await getSessionProfile();
  if (!session) {
    redirect(
      `${localePath(locale, "/sign-in")}?next=${localePath(locale, "/authority/field-rescue")}`,
    );
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
  const tNav = await getTranslations("nav");
  return (
    <div className="flex flex-col gap-5">
      <NextIntlClientProvider messages={fieldRescueMessages(await getMessages())}>
        <FieldRescue unitId={units[0]!.id} />
      </NextIntlClientProvider>
      <BackLink href="/authority" label={tNav("backBoard")} />
    </div>
  );
}
