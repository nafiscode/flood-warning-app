import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { DamReleaseForm } from "@/components/admin/DamReleaseForm";
import { MyCases } from "@/components/authority/MyCases";
import { TeamMembers } from "@/components/authority/TeamMembers";
import { AuthorityExample } from "@/components/dev/AuthorityExample";
import { HomeExample, MapExample } from "@/components/dev/Examples";
import { Journey } from "@/components/journey/Journey";
import { Link } from "@/i18n/navigation";
import { getSessionProfile, isAdminRole } from "@/lib/auth";
import { bangkokValue } from "@/lib/dam-release";
import { readDamsForRelease } from "@/lib/dam-release-data";
import { unitJourney } from "@/lib/journey";
import {
  authorityMessages,
  damReleaseMessages,
  fieldCrewMessages,
  homeMessages,
  mapMessages,
  unitTeamMessages,
} from "@/lib/messages";
import {
  exampleCrewWork,
  examplePendingUnit,
  exampleRescueBoard,
  exampleSupplyBoard,
  exampleTeam,
  isPreviewRole,
  previewNow,
  PREVIEW_ROLES,
  RESIDENT_SCENARIOS,
  residentScenario,
  type PreviewRole,
} from "@/lib/role-preview";
import { createClient } from "@/lib/supabase/server";
import { buttonSecondary, card, hint, notice } from "@/lib/ui";
import { previewOperatorSend } from "./actions";

export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const chip =
  "inline-flex min-h-tap items-center rounded-xl border border-jaga-line bg-jaga-surface px-3 text-small font-medium text-jaga-ink";
const chipHere = "border-2 border-jaga-edge font-bold";

/** A phone-sized frame, so a resident's screens are judged at the width they are used at. */
function PhoneFrame({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="mx-auto w-full max-w-[400px] rounded-[28px] border-4 border-jaga-edge bg-jaga-ground p-3"
      data-preview-frame="phone"
    >
      {children}
    </div>
  );
}

/**
 * "View as another role" (the owner, 14 Oct). Each role's own screens with made-up data, so an
 * admin can see what a visitor, a resident, a team or a dam operator experiences. The admin
 * layout has already turned away everyone else; this page reads no one's data and sends nothing
 * (the operator's button only comes back here). The header above stays the admin's own.
 */
export default async function RolePreview({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; role: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, role } = await params;
  setRequestLocale(locale);
  if (!isPreviewRole(role)) notFound();
  // A layout and its page render side by side: ask here too, so a visitor's request does nothing.
  const session = await getSessionProfile();
  if (!session || !isAdminRole(session.role)) notFound();
  const query = await searchParams;
  const t = await getTranslations("rolePreview");
  const tNav = await getTranslations("admin.nav");
  const messages = await getMessages();
  const now = previewNow();

  const body = await (async (r: PreviewRole) => {
    if (r === "visitor") {
      return (
        <PhoneFrame>
          <NextIntlClientProvider messages={homeMessages(messages)}>
            <HomeExample scenario="choose" />
          </NextIntlClientProvider>
        </PhoneFrame>
      );
    }
    if (r === "resident") {
      const view = query.view === "map" ? "map" : "home";
      const scenario = residentScenario(query.s);
      const tDev = await getTranslations("devHome");
      return (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2" data-preview-views>
            {(["home", "map"] as const).map((v) => (
              <Link
                key={v}
                href={{ pathname: `/admin/preview/resident`, query: { view: v } }}
                aria-current={v === view ? "page" : undefined}
                className={`${chip} ${v === view ? chipHere : ""}`}
              >
                {t(`resident.${v}`)}
              </Link>
            ))}
          </div>
          {view === "map" ? (
            <NextIntlClientProvider messages={mapMessages(messages)}>
              <MapExample />
            </NextIntlClientProvider>
          ) : (
            <>
              <div className="flex flex-wrap gap-2" data-preview-scenarios>
                {RESIDENT_SCENARIOS.map((s) => (
                  <Link
                    key={s}
                    href={{ pathname: `/admin/preview/resident`, query: { s } }}
                    aria-current={s === scenario ? "true" : undefined}
                    className={`${chip} ${s === scenario ? chipHere : ""}`}
                  >
                    {tDev(`scenario.${s}`)}
                  </Link>
                ))}
              </div>
              <PhoneFrame>
                <NextIntlClientProvider messages={homeMessages(messages)}>
                  <HomeExample key={scenario} scenario={scenario} />
                </NextIntlClientProvider>
              </PhoneFrame>
            </>
          )}
        </div>
      );
    }
    if (r === "rescue" || r === "supplies") {
      // The board (a war room on a laptop, the tabbed board on a phone) or the page the team's
      // owner invites people on (24 Oct 2026).
      const view = query.view === "people" ? "people" : "board";
      return (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2" data-preview-views>
            {(["board", "people"] as const).map((v) => (
              <Link
                key={v}
                href={{ pathname: `/admin/preview/${r}`, query: { view: v } }}
                aria-current={v === view ? "page" : undefined}
                className={`${chip} ${v === view ? chipHere : ""}`}
              >
                {t(`team.${v}`)}
              </Link>
            ))}
          </div>
          {view === "people" ? (
            <>
              <p className={hint}>{t("team.peopleNote")}</p>
              <NextIntlClientProvider messages={unitTeamMessages(messages)}>
                <TeamMembers teams={exampleTeam(now)} preview />
              </NextIntlClientProvider>
            </>
          ) : (
            <NextIntlClientProvider messages={authorityMessages(messages)}>
              {r === "rescue" ? (
                <AuthorityExample start={exampleRescueBoard()} />
              ) : (
                <AuthorityExample start={exampleSupplyBoard()} />
              )}
            </NextIntlClientProvider>
          )}
        </div>
      );
    }
    if (r === "crew") {
      return (
        <PhoneFrame>
          <NextIntlClientProvider messages={fieldCrewMessages(messages)}>
            <MyCases initial={exampleCrewWork(now)} preview />
          </NextIntlClientProvider>
        </PhoneFrame>
      );
    }
    if (r === "pending") {
      const tAuthority = await getTranslations("authority");
      const tAccount = await getTranslations("account");
      const unit = examplePendingUnit(now);
      return (
        <PhoneFrame>
          <div className="flex flex-col gap-5">
            <section className={card} data-preview-console>
              <h2 className="text-h3 font-bold text-jaga-ink">{tAuthority("notVerified.title")}</h2>
              <p>{tAuthority("notVerified.body")}</p>
              <span className={buttonSecondary}>{tAuthority("notVerified.account")}</span>
            </section>
            <section className={card} data-preview-account>
              <h2 className="text-body font-bold">{tAccount("authority.title")}</h2>
              <p>
                {unit.name}
                <span className={`block ${hint}`}>{tAccount("authority.status.pending")}</span>
              </p>
              <Journey journey={unitJourney(unit)} />
              <p className={hint}>{tAccount("authority.registered")}</p>
            </section>
          </div>
        </PhoneFrame>
      );
    }
    // The dam operator: the real dams and figures, the reviewed template, a button that sends
    // nothing. Bang Lang first, the dam the operator's screen was planned for.
    const dams = await readDamsForRelease(await createClient());
    const dam = dams.find((d) => d.code === "bang_lang") ?? dams[0];
    const at = new Date(now);
    return (
      <div className="flex flex-col gap-4">
        <p>{t("operator.lead")}</p>
        <p className={hint}>{t("operator.notYet")}</p>
        {query.sent === "1" && (
          <p className={notice} role="status" data-preview-sent>
            {t("operator.sent")}
          </p>
        )}
        <section className={card}>
          <NextIntlClientProvider messages={damReleaseMessages(messages)}>
            <DamReleaseForm
              dams={dam ? [dam] : []}
              send={previewOperatorSend.bind(null, locale)}
              nowValue={bangkokValue(at)}
              nextUpdateValue={bangkokValue(new Date(now + 6 * 3_600_000))}
              operatorSend={t("operator.send")}
            />
          </NextIntlClientProvider>
        </section>
      </div>
    );
  })(role);

  return (
    <div className="flex flex-col gap-5" data-role-preview={role}>
      <section className="flex flex-col gap-3 rounded-2xl border-2 border-dashed border-jaga-edge bg-jaga-surface p-4">
        <p className="font-bold text-jaga-ink" data-preview-banner>
          {t("banner", { role: t(`role.${role}`) })}
        </p>
        <nav aria-label={t("switch")} className="flex flex-wrap gap-2">
          {PREVIEW_ROLES.map((r) => (
            <Link
              key={r}
              href={`/admin/preview/${r}`}
              aria-current={r === role ? "page" : undefined}
              className={`${chip} ${r === role ? chipHere : ""}`}
              data-preview-role={r}
            >
              {tNav(`preview.${r}`)}
            </Link>
          ))}
        </nav>
        <p className={hint}>{t(`${role}.note`)}</p>
        <p className={hint}>{t("headerNote")}</p>
      </section>
      {body}
    </div>
  );
}
