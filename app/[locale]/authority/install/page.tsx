import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { BackLink } from "@/components/BackLink";
import { TeamInstall } from "@/components/authority/TeamInstall";
import { getSessionProfile, localePath } from "@/lib/auth";
import { installMessages } from "@/lib/messages";
import { PRIVATE_PAGE } from "@/lib/seo";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/authority/install">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "install" });
  return { title: t("team.title"), ...PRIVATE_PAGE };
}

export const dynamic = "force-dynamic";

/**
 * "Put Jaga on this device", for a verified team's people (27 Nov 2026). The bell sends them here
 * when Jaga is not installed on the device they are using. It is the same animated guide as the
 * home screen's card, opened, with the words about why it matters to a team. Nothing here reads
 * team data: it is instructions, so any signed-in person may open it.
 */
export default async function TeamInstallPage({
  params,
}: PageProps<"/[locale]/authority/install">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await getSessionProfile();
  if (!session) {
    redirect(`${localePath(locale, "/sign-in")}?next=${localePath(locale, "/authority/install")}`);
  }
  const t = await getTranslations("install");
  const tNav = await getTranslations("nav");
  return (
    <div className="flex flex-col gap-5" data-team-install-page="true">
      <h1 className="text-h3 font-bold text-jaga-ink">{t("team.title")}</h1>
      <p>{t("team.intro")}</p>
      <NextIntlClientProvider messages={installMessages(await getMessages())}>
        <TeamInstall installedText={t("team.installed")} />
      </NextIntlClientProvider>
      <BackLink href="/authority" label={tNav("backBoard")} />
    </div>
  );
}
