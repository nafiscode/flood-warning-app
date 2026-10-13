import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { InstallCard } from "@/components/InstallCard";
import { ShareApp } from "@/components/ShareApp";
import { PushCard } from "@/components/push/PushCard";
import { Link } from "@/i18n/navigation";
import { getSessionProfile, isAdminRole, localePath, needsName } from "@/lib/auth";
import { installMessages } from "@/lib/messages";
import { createClient } from "@/lib/supabase/server";
import { buttonPrimary, buttonSecondary, card, hint, notice } from "@/lib/ui";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/account">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "account" });
  return { title: t("title") };
}

/** The signed-in person's own page: who they are here, and the way out. */
export default async function Account({ params, searchParams }: PageProps<"/[locale]/account">) {
  const { locale } = await params;
  const query = await searchParams;
  setRequestLocale(locale);
  const session = await getSessionProfile();
  if (!session) redirect(localePath(locale, "/sign-in"));
  if (needsName(session)) redirect(localePath(locale, "/account/setup"));
  const t = await getTranslations("account");
  const tWatched = await getTranslations("watched");
  const tHousehold = await getTranslations("household");

  const supabase = await createClient();
  const { data: units } = await supabase
    .from("authority_units")
    .select("id, unit_name, status")
    .eq("user_id", session.userId)
    .order("created_at");

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-h3 font-bold text-jaga-ink">{t("title")}</h1>
      {query.registered === "1" && (
        <p role="status" className={notice}>
          {t("authority.registered")}
        </p>
      )}
      <section className={card}>
        <p className="text-h3 font-bold">{session.displayName}</p>
        <p className={hint}>{t(`role.${session.role}`)}</p>
        <Link href="/account/setup" className={buttonSecondary}>
          {t("edit")}
        </Link>
      </section>

      <Link href="/account/places" className={buttonSecondary}>
        {tWatched("title")}
      </Link>
      <Link href="/account/household/home" className={buttonSecondary} data-household-link="home">
        {tHousehold("link")}
      </Link>

      <section className={card}>
        <h2 className="text-body font-bold">{t("authority.title")}</h2>
        {(units ?? []).map((unit) => (
          <p key={unit.id as string}>
            {unit.unit_name as string}
            <span className={`block ${hint}`}>
              {t(`authority.status.${unit.status as "pending" | "verified" | "suspended"}`)}
            </span>
          </p>
        ))}
        {(units ?? []).some((unit) => unit.status === "verified") && (
          <Link href="/authority" className={buttonPrimary}>
            {t("authority.console")}
          </Link>
        )}
        {(units ?? []).length === 0 && <p className={hint}>{t("authority.intro")}</p>}
        <Link href="/authority/register" className={buttonSecondary}>
          {t("authority.register")}
        </Link>
      </section>

      {isAdminRole(session.role) && (
        <Link href="/admin" className={buttonSecondary}>
          {t("adminLink")}
        </Link>
      )}

      <NextIntlClientProvider messages={installMessages(await getMessages())}>
        <PushCard place="account" />
        <InstallCard place="account" />
        <ShareApp />
      </NextIntlClientProvider>

      <form action="/api/auth/sign-out" method="post">
        <button type="submit" className={buttonSecondary}>
          {t("signOut")}
        </button>
      </form>
    </div>
  );
}
