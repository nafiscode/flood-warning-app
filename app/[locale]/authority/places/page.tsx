import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { BackLink } from "@/components/BackLink";
import { PlaceChecks } from "@/components/authority/PlaceChecks";
import { Link } from "@/i18n/navigation";
import { getSessionProfile, localePath } from "@/lib/auth";
import { readMyUnits } from "@/lib/authority-board";
import { placeChecksMessages } from "@/lib/place-checks";
import { buttonSecondary, card } from "@/lib/ui";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/authority/places">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "placeChecks" });
  return { title: t("title") };
}

export const dynamic = "force-dynamic";

/**
 * "Check the safe places" (owner, 20 Oct): the round of the places a verified team covers, the
 * ones nobody has been to for longest first. Off-season it is the pre-season sweep - walk each
 * shelter once before November and confirm what the app says about it. In a flood it is what
 * keeps "open" and "full" true, which the science score can never know.
 *
 * A visitor is sent to sign in and a team that is not verified yet is told so; that only decides
 * what is drawn - the database function refuses anyone without a verified team (safety rule 5).
 */
export default async function AuthorityPlacesPage({
  params,
}: PageProps<"/[locale]/authority/places">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await getSessionProfile();
  if (!session) {
    redirect(`${localePath(locale, "/sign-in")}?next=${localePath(locale, "/authority/places")}`);
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
  const tChecks = await getTranslations("placeChecks");
  const tNav = await getTranslations("nav");
  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-2">
        <h1 className="text-h3 font-bold text-jaga-ink">{tChecks("title")}</h1>
        <p>{tChecks("intro")}</p>
      </section>
      <NextIntlClientProvider messages={placeChecksMessages(await getMessages())}>
        <PlaceChecks />
      </NextIntlClientProvider>
      <BackLink href="/authority" label={tNav("backBoard")} />
    </div>
  );
}
