import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { BackLink } from "@/components/BackLink";
import { FeedbackAsk } from "@/components/feedback/FeedbackAsk";
import { TeamMembers } from "@/components/authority/TeamMembers";
import { getSessionProfile, localePath } from "@/lib/auth";
import { unitTeamMessages } from "@/lib/messages";
import { PRIVATE_PAGE } from "@/lib/seo";
import { readTeamRecords } from "@/lib/authority-board";
import { readOwnedTeams } from "@/lib/unit-team";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/authority/team">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "unitTeam" });
  return { title: t("title"), ...PRIVATE_PAGE };
}

export const dynamic = "force-dynamic";

/**
 * "Your team's people" (24 Oct 2026): the owner of a verified team lets others in with a code
 * and says yes to each one. A visitor is sent to sign in; someone who owns no verified team is
 * shown an empty page. That only decides what is drawn: every list and every change is a
 * database function that checks the caller is the owner (safety rule 5).
 */
export default async function TeamPage({ params }: PageProps<"/[locale]/authority/team">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await getSessionProfile();
  if (!session) {
    redirect(`${localePath(locale, "/sign-in")}?next=${localePath(locale, "/authority/team")}`);
  }
  const t = await getTranslations("unitTeam");
  const teams = await readOwnedTeams(session.userId);
  /*
   * "For a team, after it has finished a case" (A15, spec 17). The ask goes on this page and not
   * on the case board: the board is where live requests are, and nothing invites a dispatcher to
   * rate the app with a case waiting. A confirmed case in the team's own record is the signal, so
   * a team that has never finished one is never asked.
   */
  const records = await readTeamRecords(session.userId).catch(() => []);
  const finishedACase = records.some((r) => r.cases > 0);
  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-h2 font-bold text-jaga-ink">{t("title")}</h1>
      <p>{t("intro")}</p>
      <NextIntlClientProvider messages={unitTeamMessages(await getMessages())}>
        <TeamMembers teams={teams} />
        <FeedbackAsk moment="finished_case" when={finishedACase} />
      </NextIntlClientProvider>
      <BackLink href="/authority" label={(await getTranslations("nav"))("backBoard")} />
    </div>
  );
}
