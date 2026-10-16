import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { DualTime } from "@/components/admin/DualTime";
import { AddSquareIcon, CheckIcon, PhoneIcon, ShieldIcon } from "@/components/icons";
import { Link } from "@/i18n/navigation";
import {
  canManageAdmins,
  DUTY_SUGGESTIONS,
  maskedPhone,
  missingPhones,
  readTeam,
  revealAdminPhone,
  sortTeam,
  waiting,
  type TeamMember,
} from "@/lib/admin-team";
import { getSessionProfile } from "@/lib/auth";
import {
  buttonPrimary,
  buttonQuiet,
  buttonSecondary,
  card,
  checkBox,
  checkRow,
  errorNotice,
  hint,
  input,
  label,
  notice,
} from "@/lib/ui";
import { addMember, approveMember, revokeMember, setDeputy, updateMember } from "./actions";

const ERRORS = ["email", "phone", "duty", "duplicate", "account", "save"] as const;
const DONE = ["added", "approved", "saved", "revoked"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/admin/members">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "admin" });
  return { title: t("members.title") };
}

/**
 * The admin team (A10, owner 16 Oct 2026): every admin, the address they sign in with, the
 * phone number the team can reach them on, and the duty the super admin gave them.
 *
 * Who sees this page: the super admin, and anybody the super admin has made a **deputy super
 * admin**. That is one question asked of the database, `can_manage_admins()`, and asked again
 * by every function the forms call — the check here only decides what is drawn.
 *
 * What is deliberately not here: a phone number in a list, and any link that carries a way in.
 * Numbers come one at a time through `reveal_admin_phone()`, which logs the look (safety rule
 * 5), and the LINE message Jaga sends an approved admin is the console's plain address, which
 * works because of their role and not because of anything in the link.
 */
export default async function AdminMembers({
  params,
  searchParams,
}: PageProps<"/[locale]/admin/members">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const query = await searchParams;
  const session = await getSessionProfile();
  if (!session) notFound();
  if (!(await canManageAdmins())) notFound();
  const t = await getTranslations("admin");
  const error = ERRORS.find((e) => e === query.error);
  const done = DONE.find((d) => d === query.done);
  const isSuper = session.role === "super_admin";

  const team = await readTeam();
  const show = typeof query.show === "string" && UUID.test(query.show) ? query.show : null;
  const shown = show ? await revealAdminPhone(show) : null;
  const pending = waiting(team);
  const active = sortTeam(team.filter((m) => m.status === "active" || m.status === "revoked"));
  const noPhone = missingPhones(team);

  /** Super admin, deputy super admin or admin, with the duty under it. */
  function Rank({ member }: { member: TeamMember }) {
    return (
      <p className={hint}>
        {t(`members.rank.${member.rank}`)}
        {member.duty ? ` · ${member.duty}` : ""}
        {member.status === "revoked" ? ` · ${t("members.status.revoked")}` : ""}
      </p>
    );
  }

  /** The number, never in the list: four digits and a button that writes the look down. */
  function Phone({ member }: { member: TeamMember }) {
    const masked = maskedPhone(member);
    if (!member.hasPhone) return <p className={hint}>{t("members.noPhone")}</p>;
    if (show && show === member.memberId && shown) {
      return (
        <p className="flex items-center gap-2 font-medium" data-admin-phone={member.memberId}>
          <PhoneIcon size={20} />
          <a href={`tel:${shown}`} className="underline">
            {shown}
          </a>
        </p>
      );
    }
    return (
      <p className="flex items-center gap-2">
        <span className={hint}>{masked}</span>
        <Link
          href={{ pathname: "/admin/members", query: { show: member.memberId } }}
          className={buttonQuiet}
          data-admin-reveal={member.memberId}
        >
          {t("members.reveal")}
        </Link>
      </p>
    );
  }

  /** How that person gets in, said plainly, because the two ways in differ. */
  function WayIn({ member }: { member: TeamMember }) {
    const key = member.lineSentAt ? "sent" : member.lineReady ? "ready" : "email";
    return <p className={hint}>{t(`members.wayIn.${key}`)}</p>;
  }

  return (
    <div className="flex flex-col gap-5" data-admin-page="members">
      <h1 className="text-h3 font-bold text-jaga-ink">{t("members.title")}</h1>
      <p className={hint}>{t("members.intro")}</p>
      {error && (
        <p role="alert" className={errorNotice}>
          {t(`members.error.${error}`)}
        </p>
      )}
      {done && (
        <p role="status" className={errorNotice}>
          {t(`members.done.${done}`)}
        </p>
      )}
      {noPhone > 0 && (
        <p className={notice} data-admin-nophone={noPhone}>
          {t("members.missingPhones", { count: noPhone })}
        </p>
      )}

      {/* Waiting: somebody who asked from their account page, or an invitation not taken up. */}
      {pending.length > 0 && (
        <section className={card}>
          <h2 className="text-body font-bold">{t("members.waiting")}</h2>
          {pending.map((member) => (
            <div
              key={member.memberId ?? member.userId}
              className="flex flex-col gap-2 border-t border-jaga-line pt-3"
              data-admin-waiting={member.memberId}
            >
              <p className="font-medium">{member.name || t("members.noName")}</p>
              <p className={`break-all ${hint}`}>{member.email ?? t("members.noEmail")}</p>
              <Phone member={member} />
              <p className={hint}>
                {t(`members.status.${member.status}`)} · <DualTime iso={member.createdAt} />
              </p>
              {member.status === "requested" && (
                <form action={approveMember} className="flex flex-col gap-2">
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="member" value={member.memberId ?? ""} />
                  <label htmlFor={`duty-${member.memberId}`} className={label}>
                    {t("members.duty")}
                  </label>
                  <input
                    id={`duty-${member.memberId}`}
                    name="duty"
                    list="admin-duties"
                    required
                    className={input}
                  />
                  <button type="submit" className={buttonPrimary} data-approve={member.memberId}>
                    <CheckIcon size={22} />
                    {t("members.approve")}
                  </button>
                </form>
              )}
              <form action={revokeMember} className="flex flex-col gap-2">
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="member" value={member.memberId ?? ""} />
                <input
                  name="reason"
                  placeholder={t("members.reasonHint")}
                  aria-label={t("members.reason")}
                  className={input}
                />
                <button type="submit" className={buttonSecondary} data-revoke={member.memberId}>
                  {t("members.turnDown")}
                </button>
              </form>
            </div>
          ))}
        </section>
      )}

      {/* The team itself. */}
      <section className={card}>
        <h2 className="text-body font-bold">{t("members.list")}</h2>
        {active.map((member) => (
          <div
            key={member.memberId ?? member.userId}
            className="flex flex-col gap-2 border-t border-jaga-line pt-3"
            data-admin-member={member.memberId ?? member.userId}
          >
            <p className="font-medium">
              {member.name || t("members.noName")}
              {member.rank !== "admin" && <ShieldIcon size={20} />}
            </p>
            <Rank member={member} />
            <p className={`break-all ${hint}`}>{member.email ?? t("members.noEmail")}</p>
            <Phone member={member} />
            <WayIn member={member} />

            {member.status === "active" && member.memberId && (
              <details>
                <summary className="min-h-tap cursor-pointer font-medium">
                  {t("members.change")}
                </summary>
                <form action={updateMember} className="flex flex-col gap-2 pt-2">
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="member" value={member.memberId} />
                  <label htmlFor={`name-${member.memberId}`} className={label}>
                    {t("members.name")}
                  </label>
                  <input
                    id={`name-${member.memberId}`}
                    name="name"
                    defaultValue={member.name}
                    className={input}
                  />
                  <label htmlFor={`edit-duty-${member.memberId}`} className={label}>
                    {t("members.duty")}
                  </label>
                  <input
                    id={`edit-duty-${member.memberId}`}
                    name="duty"
                    list="admin-duties"
                    defaultValue={member.duty}
                    className={input}
                  />
                  <label htmlFor={`phone-${member.memberId}`} className={label}>
                    {t("members.phone")}
                  </label>
                  <input
                    id={`phone-${member.memberId}`}
                    name="phone"
                    type="tel"
                    inputMode="tel"
                    placeholder={t("members.phoneKeep")}
                    className={input}
                  />
                  <button type="submit" className={buttonSecondary}>
                    {t("members.save")}
                  </button>
                </form>
                {isSuper && member.rank !== "super" && (
                  <form action={setDeputy} className="pt-2">
                    <input type="hidden" name="locale" value={locale} />
                    <input type="hidden" name="member" value={member.memberId} />
                    <input type="hidden" name="deputy" value={member.rank === "deputy" ? "0" : "1"} />
                    <button type="submit" className={buttonSecondary} data-deputy={member.memberId}>
                      {t(member.rank === "deputy" ? "members.deputyOff" : "members.deputyOn")}
                    </button>
                  </form>
                )}
                {member.rank !== "super" && member.userId !== session.userId && (
                  <form action={revokeMember} className="flex flex-col gap-2 pt-2">
                    <input type="hidden" name="locale" value={locale} />
                    <input type="hidden" name="member" value={member.memberId} />
                    <input
                      name="reason"
                      placeholder={t("members.reasonHint")}
                      aria-label={t("members.reason")}
                      className={input}
                    />
                    <button type="submit" className={buttonSecondary} data-revoke={member.memberId}>
                      {t("members.remove")}
                    </button>
                  </form>
                )}
              </details>
            )}
            {!member.memberId && <p className={hint}>{t("members.noRow")}</p>}
          </div>
        ))}
      </section>

      {/* Adding somebody. */}
      <form action={addMember} className={card}>
        <input type="hidden" name="locale" value={locale} />
        <h2 className="text-body font-bold">{t("members.new")}</h2>
        <label htmlFor="new-name" className={label}>
          {t("members.name")}
        </label>
        <input id="new-name" name="name" autoComplete="off" className={input} />
        <label htmlFor="new-email" className={label}>
          {t("members.email")}
        </label>
        <input
          id="new-email"
          name="email"
          type="email"
          autoComplete="off"
          required
          className={input}
        />
        <label htmlFor="new-phone" className={label}>
          {t("members.phone")}
        </label>
        <input
          id="new-phone"
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="off"
          required
          className={input}
        />
        <label htmlFor="new-duty" className={label}>
          {t("members.duty")}
        </label>
        <input
          id="new-duty"
          name="duty"
          list="admin-duties"
          autoComplete="off"
          required
          className={input}
        />
        <p className={hint}>{t("members.dutyHint")}</p>
        {isSuper && (
          <label className={checkRow} htmlFor="new-deputy">
            <input id="new-deputy" name="deputy" type="checkbox" className={checkBox} />
            <span>
              {t("members.rank.deputy")}
              <span className={`block ${hint}`}>{t("members.deputyHint")}</span>
            </span>
          </label>
        )}
        <button type="submit" className={buttonPrimary}>
          <AddSquareIcon size={22} />
          {t("members.add")}
        </button>
        <p className={hint}>{t("members.how")}</p>
      </form>

      <datalist id="admin-duties">
        {DUTY_SUGGESTIONS.map((duty) => (
          <option key={duty} value={t(`members.duties.${duty}`)} />
        ))}
      </datalist>

      {isSuper && (
        <Link href="/admin/invitations" className={buttonSecondary}>
          {t("members.invitations")}
        </Link>
      )}
    </div>
  );
}
