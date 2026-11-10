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
import { PRIVATE_PAGE } from "@/lib/seo";
import { countWaiting } from "@/lib/unit-team";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/authority">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "authority" });
  return { title: t("title"), ...PRIVATE_PAGE };
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
      <section className={card} data-tour="not-verified">
        <h1 className="text-h3 font-bold text-jaga-ink">{t("notVerified.title")}</h1>
        <p>{t("notVerified.body")}</p>
        <Link href="/account" className={buttonSecondary}>
          {t("notVerified.account")}
        </Link>
      </section>
    );
  }
  /*
   * An office and nothing else: a dam operator (A12 part 2, 9 Nov 2026) or a planning office
   * (A19, 10 Nov 2026). Their unit is verified like any other, but it is not a team in the field:
   * it holds no case, is never offered one, and the database turns it away from the case board
   * (`unit_is_office_only`). So the console it opens is its own screen or screens, not an empty
   * war room. A unit that is both - an irrigation office that also runs boats - falls through to
   * the board below with the extra links in its tools.
   */
  const OFFICE = ["dam", "planning"];
  const officeOnly = units.every((u) => u.capabilities.every((c) => OFFICE.includes(c)));
  const hasDam = units.some((u) => u.capabilities.includes("dam"));
  const hasPlanning = units.some((u) => u.capabilities.includes("planning"));
  const tDam = await getTranslations("damOperator");
  const tPaths = await getTranslations("highwayPaths");
  if (officeOnly) {
    return (
      <div className="flex flex-col gap-5">
        {hasDam && (
          <section className={card} data-dam-operator-console="true">
            <h1 className="text-h3 font-bold text-jaga-ink">{tDam("title")}</h1>
            <p>{tDam("lead")}</p>
            <Link href="/authority/dam" className={buttonSecondary} data-dam-release-link="true">
              {tDam("link")}
            </Link>
          </section>
        )}
        {hasPlanning && (
          <section className={card} data-planning-console="true">
            <h1 className="text-h3 font-bold text-jaga-ink">{tPaths("title")}</h1>
            <p>{tPaths("lead")}</p>
            <Link
              href="/authority/highway-paths"
              className={buttonSecondary}
              data-highway-paths-link="true"
            >
              {tPaths("link")}
            </Link>
          </section>
        )}
        <BackLink label={(await getTranslations("nav"))("backHome")} />
      </div>
    );
  }

  const board = await readAuthorityBoard(session.userId);
  const tField = await getTranslations("fieldRescue");
  const tChecks = await getTranslations("placeChecks");
  // Only the registrant has the team's people to manage; a dispatcher is not shown the link.
  const tTeam = await getTranslations("unitTeam");
  const isOwner = units.some((u) => u.isOwner);
  const waiting = isOwner ? await countWaiting(session.userId) : 0;
  // The team's other tools: stacked above the board on a phone, one menu in the war room (24 Oct).
  const tools = (
    <nav className="flex flex-col gap-3" data-team-tools="true">
      {/* For people the team found by itself, who never sent an SOS (the owner, 13-14 Oct). */}
      <Link
        href="/authority/field-rescue"
        className={buttonSecondary}
        data-field-rescue-link="true"
      >
        {tField("link")}
      </Link>
      {/* The round of the safe places this team covers (owner, 20 Oct). */}
      <Link href="/authority/places" className={buttonSecondary} data-place-checks-link="true">
        {tChecks("link")}
      </Link>
      {/* A team that also operates a dam (an irrigation office that runs boats as well). */}
      {hasDam && (
        <Link href="/authority/dam" className={buttonSecondary} data-dam-release-link="true">
          {tDam("link")}
        </Link>
      )}
      {/* A team that also does the planning work: an irrigation office that runs boats (A19). */}
      {hasPlanning && (
        <Link
          href="/authority/highway-paths"
          className={buttonSecondary}
          data-highway-paths-link="true"
        >
          {tPaths("link")}
        </Link>
      )}
      {isOwner && (
        <Link href="/authority/team" className={buttonSecondary} data-team-link="true">
          {waiting > 0 ? tTeam("linkWaiting", { count: waiting }) : tTeam("link")}
        </Link>
      )}
    </nav>
  );
  return (
    <div className="flex flex-col gap-5">
      <NextIntlClientProvider messages={authorityMessages(await getMessages())}>
        <Console initial={board} tools={tools} />
      </NextIntlClientProvider>
      {/* On a laptop or tablet the war room fills the window and the header has Home (24 Oct). */}
      <div className="flex flex-col console:hidden">
        <BackLink label={(await getTranslations("nav"))("backHome")} />
      </div>
    </div>
  );
}
