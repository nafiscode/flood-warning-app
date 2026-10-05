import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { DualTime } from "@/components/admin/DualTime";
import { getSessionProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  buttonPrimary,
  buttonSecondary,
  card,
  checkBox,
  checkRow,
  errorNotice,
  hint,
  input,
  label,
} from "@/lib/ui";
import { inviteAdmin, removeAdmin, revokeInvitation } from "./actions";

const ERRORS = ["forbidden", "email", "duplicate", "account", "unavailable", "save"] as const;
const DONE = ["invited", "revoked", "removed"] as const;

type Invitation = {
  id: string;
  email_or_phone: string;
  role: "admin" | "super_admin";
  status: "pending" | "accepted" | "revoked" | "expired";
  created_at: string;
};
type Admin = { user_id: string; display_name: string; role: "admin" | "super_admin" };

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/admin/invitations">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "admin" });
  return { title: t("invitations.title") };
}

/** Super admin only: invite admins by email, withdraw invitations, remove an admin role. */
export default async function AdminInvitations({
  params,
  searchParams,
}: PageProps<"/[locale]/admin/invitations">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const query = await searchParams;
  const session = await getSessionProfile();
  if (session?.role !== "super_admin") notFound();
  const t = await getTranslations("admin");
  const error = ERRORS.find((e) => e === query.error);
  const done = DONE.find((d) => d === query.done);

  const supabase = await createClient();
  const [{ data: invitations }, { data: admins }] = await Promise.all([
    supabase
      .from("admin_invitations")
      .select("id, email_or_phone, role, status, created_at")
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("profiles")
      .select("user_id, display_name, role")
      .in("role", ["admin", "super_admin"])
      .order("created_at"),
  ]);

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-h3 font-bold text-jaga-slate">{t("invitations.title")}</h1>
      {error && (
        <p role="alert" className={errorNotice}>
          {t(`invitations.error.${error}`)}
        </p>
      )}
      {done && (
        <p role="status" className={errorNotice}>
          {t(`invitations.done.${done}`)}
        </p>
      )}

      <form action={inviteAdmin} className={card}>
        <input type="hidden" name="locale" value={locale} />
        <h2 className="text-body font-bold">{t("invitations.new")}</h2>
        <label htmlFor="email" className={label}>
          {t("invitations.email")}
        </label>
        <input id="email" name="email" type="email" autoComplete="off" required className={input} />
        <label className={checkRow}>
          <input type="checkbox" name="role" value="super_admin" className={checkBox} />
          <span>
            {t("invitations.asSuperAdmin")}
            <span className={`block ${hint}`}>{t("invitations.asSuperAdminHint")}</span>
          </span>
        </label>
        <button type="submit" className={buttonPrimary}>
          {t("invitations.send")}
        </button>
        <p className={hint}>{t("invitations.how")}</p>
      </form>

      <section className={card}>
        <h2 className="text-body font-bold">{t("invitations.list")}</h2>
        {((invitations ?? []) as Invitation[]).map((invitation) => (
          <div key={invitation.id} className="flex flex-col gap-1 border-t border-jaga-line pt-3">
            <p className="break-all font-medium">{invitation.email_or_phone}</p>
            <p className={hint}>
              {t(`role.${invitation.role}`)} · {t(`invitations.status.${invitation.status}`)} ·{" "}
              <DualTime iso={invitation.created_at} bangkokLabel={t("bangkokTime")} />
            </p>
            {invitation.status === "pending" && (
              <form action={revokeInvitation}>
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="invitation" value={invitation.id} />
                <button type="submit" className="min-h-tap underline">
                  {t("invitations.revoke")}
                </button>
              </form>
            )}
          </div>
        ))}
        {(invitations ?? []).length === 0 && <p className={hint}>{t("invitations.none")}</p>}
      </section>

      <section className={card}>
        <h2 className="text-body font-bold">{t("invitations.admins")}</h2>
        {((admins ?? []) as Admin[]).map((admin) => (
          <div key={admin.user_id} className="flex flex-col gap-1 border-t border-jaga-line pt-3">
            <p className="font-medium">{admin.display_name || t("invitations.noName")}</p>
            <p className={hint}>{t(`role.${admin.role}`)}</p>
            {admin.user_id !== session.userId && (
              <form action={removeAdmin}>
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="user" value={admin.user_id} />
                <button type="submit" className={buttonSecondary}>
                  {t("invitations.remove")}
                </button>
              </form>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}
