import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { BackLink } from "@/components/BackLink";
import { JoinTeam } from "@/components/authority/JoinTeam";
import { getSessionProfile, localePath } from "@/lib/auth";
import { unitTeamMessages } from "@/lib/messages";
import { PRIVATE_PAGE } from "@/lib/seo";

import { formColumn } from "@/lib/ui";
export async function generateMetadata({
  params,
}: PageProps<"/[locale]/authority/join">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "unitTeam" });
  return { title: t("join.title"), ...PRIVATE_PAGE };
}

export const dynamic = "force-dynamic";

/**
 * "Join a team" (24 Oct 2026): a code from the owner of a verified team, typed or arriving in a
 * link. A visitor signs in first, with the code carried through, because the database needs to
 * know who is asking. Joining only puts the person in the owner's waiting list.
 */
export default async function JoinPage({
  params,
  searchParams,
}: PageProps<"/[locale]/authority/join">) {
  const { locale } = await params;
  const query = await searchParams;
  setRequestLocale(locale);
  const raw = typeof query.code === "string" ? query.code : "";
  // Letters and digits only, so nothing but a code can travel into the sign-in address or the field.
  const code = raw.replace(/[^0-9A-Za-z]/g, "").slice(0, 20);
  const here = `${localePath(locale, "/authority/join")}${code ? `?code=${code}` : ""}`;
  const session = await getSessionProfile();
  if (!session) redirect(`${localePath(locale, "/sign-in")}?next=${encodeURIComponent(here)}`);
  const t = await getTranslations("unitTeam");
  const tNav = await getTranslations("nav");
  return (
    <div className={`flex flex-col gap-5 ${formColumn}`}>
      <h1 className="text-h2 font-bold text-jaga-ink">{t("join.title")}</h1>
      <p>{t("join.intro")}</p>
      <NextIntlClientProvider messages={unitTeamMessages(await getMessages())}>
        <JoinTeam initialCode={code} />
      </NextIntlClientProvider>
      {/* Back to the account it was reached from, and to the home screen (24 Oct). */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <BackLink href="/account" label={tNav("backAccount")} />
        <BackLink label={tNav("backHome")} />
      </div>
    </div>
  );
}
