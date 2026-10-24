import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { InstallCard } from "@/components/InstallCard";
import { Journey } from "@/components/journey/Journey";
import { ShareApp } from "@/components/ShareApp";
import { PushCard } from "@/components/push/PushCard";
import { Link } from "@/i18n/navigation";
import { readMyAdminRequest } from "@/lib/admin-team";
import { getSessionProfile, isAdminRole, localePath, needsName } from "@/lib/auth";
import { toUnitRequest, unitJourney } from "@/lib/journey";
import { installMessages } from "@/lib/messages";
import { createClient } from "@/lib/supabase/server";
import { buttonPrimary, buttonSecondary, card, hint, input, label, notice } from "@/lib/ui";
import {
  AddSquareIcon,
  EditIcon,
  HouseIcon,
  LifebuoyIcon,
  ListIcon,
  MapIcon,
  PinIcon,
  ShieldIcon,
  SignOutIcon,
} from "@/components/icons";
import { SignOutForm } from "@/components/account/SignOutForm";
import { readMemberships } from "@/lib/unit-team";
import { askForAdminAccess } from "./actions";

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
  const tCapabilities = await getTranslations("capabilities");
  const tWatched = await getTranslations("watched");
  const tHousehold = await getTranslations("household");
  const tJourney = await getTranslations("journey");
  const tTeam = await getTranslations("unitTeam");

  const supabase = await createClient();
  const { data: units } = await supabase
    .from("authority_units")
    .select("id, unit_name, status, created_at, verified_at, updated_at")
    .eq("user_id", session.userId)
    .order("created_at");
  // Teams an owner has let this person into, or that they are waiting to join (24 Oct).
  const memberships = await readMemberships();
  // Why an admin turned a registration down (owner, 16 Oct): read through the function, because
  // the audit log that holds the words is admins-only.
  const { data: reviewed } = await supabase.rpc("my_unit_reviews");
  // Where their own ask to help run Jaga stands, if they have made one (A10).
  const adminRequest = isAdminRole(session.role) ? null : await readMyAdminRequest();
  const reasons = new Map<string, string>(
    (Array.isArray(reviewed) ? (reviewed as Record<string, unknown>[]) : [])
      .filter((r) => typeof r.unit_id === "string" && typeof r.reason === "string")
      .map((r) => [r.unit_id as string, r.reason as string]),
  );

  return (
    <div className="flex flex-col gap-5" data-console-page="account" data-console-flow="true">
      <h1 className="text-h3 font-bold text-jaga-ink" data-console-full="true">
        {t("title")}
      </h1>
      {query.registered === "1" && (
        <p role="status" className={notice} data-console-full="true">
          {t("authority.registered")}
        </p>
      )}
      <section className={card}>
        <p className="text-h3 font-bold">{session.displayName}</p>
        <p className={hint}>{t(`role.${session.role}`)}</p>
        <Link href="/account/setup" className={buttonSecondary}>
          <EditIcon size={22} />
          {t("edit")}
        </Link>
      </section>

      <Link href="/requests" className={buttonSecondary} data-requests-link="account">
        <ListIcon size={22} />
        {tJourney("link")}
      </Link>
      <Link href="/account/places" className={buttonSecondary}>
        <PinIcon size={22} />
        {tWatched("title")}
      </Link>
      <Link href="/account/household/home" className={buttonSecondary} data-household-link="home">
        <HouseIcon size={22} />
        {tHousehold("link")}
      </Link>

      <section className={card}>
        <h2 className="text-body font-bold">{t("authority.title")}</h2>
        {(units ?? []).map((unit) => {
          // Where the registration stands, as steps (the owner, 13 Oct).
          const request = toUnitRequest({
            ...unit,
            review_note: reasons.get(String(unit.id)) ?? null,
          });
          return (
            <div key={unit.id as string} className="flex flex-col gap-2" data-unit={unit.id}>
              <p>
                {unit.unit_name as string}
                <span className={`block ${hint}`}>
                  {t(
                    `authority.status.${unit.status as "pending" | "verified" | "rejected" | "suspended"}`,
                  )}
                </span>
              </p>
              {request && (
                <Journey journey={unitJourney(request)} compact={request.status !== "pending"} />
              )}
            </div>
          );
        })}
        {memberships.length > 0 && (
          <div className="flex flex-col gap-2" data-memberships="true">
            <h3 className="font-bold">{tTeam("joined.title")}</h3>
            {memberships.map((m) => (
              <p key={m.unitId} data-membership={m.unitId}>
                {m.unitName}
                <span className={`block ${hint}`}>
                  {m.orgName ? `${m.orgName} · ` : ""}
                  {tTeam(`role.${m.role}`)}
                  {m.status === "pending" ? ` · ${tTeam("joined.waiting")}` : ""}
                </span>
              </p>
            ))}
          </div>
        )}
        {((units ?? []).some((unit) => unit.status === "verified") ||
          memberships.some((m) => m.status === "active" && m.role === "dispatcher")) && (
          <Link href="/authority" className={buttonPrimary}>
            <LifebuoyIcon size={22} />
            {t("authority.console")}
          </Link>
        )}
        {(units ?? []).length === 0 && <p className={hint}>{t("authority.intro")}</p>}
        <Link href="/authority/register" className={buttonSecondary}>
          <AddSquareIcon size={22} />
          {t("authority.register")}
        </Link>
        {memberships.some((m) => m.status === "active") && (
          <Link href="/authority/mine" className={buttonPrimary} data-my-cases-link="true">
            <LifebuoyIcon size={22} />
            {tTeam("myCasesLink")}
          </Link>
        )}
        <Link href="/authority/join" className={buttonSecondary} data-join-link="true">
          <AddSquareIcon size={22} />
          {tTeam("joinLink")}
        </Link>
      </section>

      {/* Helping run Jaga (A10, owner 16 Oct 2026). Nothing is granted here: the request goes
          to the admin team page and waits for the super admin. An admin already has the role,
          so the section is not drawn for them. */}
      {!isAdminRole(session.role) && (
        <section className={card} data-admin-ask="account">
          <h2 className="text-body font-bold">{t("adminAsk.title")}</h2>
          {query.adminError && (
            <p role="alert" className={notice}>
              {t(
                `adminAsk.error.${["phone", "note", "already", "save"].includes(String(query.adminError)) ? query.adminError : "save"}`,
              )}
            </p>
          )}
          {adminRequest ? (
            <p className={hint} data-admin-ask-status={adminRequest.status}>
              {t(`adminAsk.status.${adminRequest.status}`)}
            </p>
          ) : (
            <details open={query.adminAsked === "1" || Boolean(query.adminError)}>
              <summary className="min-h-tap cursor-pointer font-medium">
                {t("adminAsk.open")}
              </summary>
              <form action={askForAdminAccess} className="flex flex-col gap-2 pt-2">
                <input type="hidden" name="locale" value={locale} />
                <p className={hint}>{t("adminAsk.intro")}</p>
                <label htmlFor="admin-ask-phone" className={label}>
                  {t("adminAsk.phone")}
                </label>
                <input
                  id="admin-ask-phone"
                  name="phone"
                  type="tel"
                  inputMode="tel"
                  required
                  className={input}
                />
                <label htmlFor="admin-ask-note" className={label}>
                  {t("adminAsk.note")}
                </label>
                <input id="admin-ask-note" name="note" required className={input} />
                <button type="submit" className={buttonSecondary}>
                  {t("adminAsk.send")}
                </button>
              </form>
            </details>
          )}
        </section>
      )}

      {/* What Jaga can do (A17), opened on this person's own kind of role. */}
      <Link
        href={
          isAdminRole(session.role)
            ? "/features#admin"
            : (units ?? []).length > 0
              ? "/features#team"
              : "/features"
        }
        className={buttonSecondary}
        data-features-link="account"
      >
        <MapIcon size={22} />
        {tCapabilities("link")}
      </Link>

      {isAdminRole(session.role) && (
        <Link href="/admin" className={buttonSecondary}>
          <ShieldIcon size={22} />
          {t("adminLink")}
        </Link>
      )}

      <NextIntlClientProvider messages={installMessages(await getMessages())}>
        <PushCard place="account" />
        <InstallCard place="account" />
        <ShareApp />
      </NextIntlClientProvider>

      <SignOutForm>
        <button type="submit" className={buttonSecondary}>
          <SignOutIcon size={22} />
          {t("signOut")}
        </button>
      </SignOutForm>
    </div>
  );
}
