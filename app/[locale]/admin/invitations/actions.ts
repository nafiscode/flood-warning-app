"use server";

import { redirect } from "next/navigation";
import { getSessionProfile, localePath } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function field(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === "string" ? v.trim() : "";
}

function back(form: FormData, params: Record<string, string>): never {
  const path = localePath(field(form, "locale"), "/admin/invitations");
  redirect(`${path}?${new URLSearchParams(params)}`);
}

/**
 * Invite an admin by email. Two things happen:
 * 1. the invitation row is written with the caller's own session, so row-level security
 *    enforces "super admin only";
 * 2. an account is created for that address with the secret key, because the email-link form
 *    never creates accounts. The account is a plain user: the admin role is granted by the
 *    database only when that person signs in through a link sent to that address.
 */
export async function inviteAdmin(form: FormData) {
  const session = await getSessionProfile();
  if (session?.role !== "super_admin") back(form, { error: "forbidden" });
  const email = field(form, "email").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
    back(form, { error: "email" });
  const role = field(form, "role") === "super_admin" ? "super_admin" : "admin";

  const admin = createAdminClient();
  if (!admin) back(form, { error: "unavailable" });

  const { error: createError } = await admin.auth.admin.createUser({ email, email_confirm: true });
  // "Already registered" is fine: the person then just signs in with the email link.
  if (createError && createError.status !== 422 && createError.code !== "email_exists") {
    back(form, { error: "account" });
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("admin_invitations")
    .insert({ email_or_phone: email, role, invited_by: session.userId });
  if (error) back(form, { error: error.code === "23505" ? "duplicate" : "save" });
  back(form, { done: "invited" });
}

export async function revokeInvitation(form: FormData) {
  const id = field(form, "invitation");
  if (!UUID.test(id)) back(form, { error: "save" });
  const supabase = await createClient();
  const { error } = await supabase
    .from("admin_invitations")
    .update({ status: "revoked" })
    .eq("id", id)
    .eq("status", "pending");
  if (error) back(form, { error: "save" });
  back(form, { done: "revoked" });
}

/** Remove someone's admin role. The database refuses unless the caller is the super admin. */
export async function removeAdmin(form: FormData) {
  const user = field(form, "user");
  if (!UUID.test(user)) back(form, { error: "save" });
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_admin_role", { p_user_id: user, p_role: "user" });
  if (error) back(form, { error: "save" });
  back(form, { done: "removed" });
}
