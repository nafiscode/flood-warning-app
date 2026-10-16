"use server";

import { redirect } from "next/navigation";
import { localePath } from "@/lib/auth";
import { normalizePhone } from "@/lib/phone";
import { sendAdminWelcome } from "@/lib/line-server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * The admin team page's writes. Every one of them is a database function that checks for
 * itself who is calling (`can_manage_admins()`, or the super admin alone for a deputy): what
 * is below only shapes the form and says where to go next (safety rule 5).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function field(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === "string" ? v.trim() : "";
}

function back(form: FormData, params: Record<string, string>): never {
  const path = localePath(field(form, "locale"), "/admin/members");
  redirect(`${path}?${new URLSearchParams(params)}`);
}

/** The database's own words are not shown; each failure gets one of the page's messages. */
function failed(form: FormData, code: string | undefined): never {
  back(form, { error: code === "23505" ? "duplicate" : "save" });
}

/**
 * Put somebody on the team. Three things happen, in this order:
 *  1. an account is created for the address with the secret key, because the email-link form
 *     never creates one (as on the invitations page);
 *  2. the roster row and the phone number are written by `add_admin_member`, which also writes
 *     the ordinary admin invitation, so the existing sign-in path keeps working unchanged;
 *  3. if that person already had an account and Jaga knows their LINE, their way in goes out.
 */
export async function addMember(form: FormData) {
  const email = field(form, "email").toLowerCase();
  // The same shape as every other phone number in Jaga (+66...): an admin's number is read by
  // somebody who may not be in Thailand, and "089..." cannot be dialled from abroad.
  const phone = normalizePhone(field(form, "phone"));
  const duty = field(form, "duty");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) back(form, { error: "email" });
  if (!phone) back(form, { error: "phone" });
  if (duty === "") back(form, { error: "duty" });

  // No secret key means no Auth admin API, which is the only thing that can open an account
  // for an address — and it is deliberately absent from the live site. The row is still
  // written, because the team list is worth keeping either way, but the admin is told plainly
  // that this person cannot sign in yet rather than left to find out when they try.
  const admin = createAdminClient();
  let opened = true;
  if (admin) {
    const { error } = await admin.auth.admin.createUser({ email, email_confirm: true });
    // "Already registered" is the ordinary case: they then just sign in.
    if (error && error.status !== 422 && error.code !== "email_exists") {
      back(form, { error: "account" });
    }
  } else {
    opened = false;
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("add_admin_member", {
    p_email: email,
    p_full_name: field(form, "name"),
    p_phone: phone,
    p_duty: duty,
    p_deputy: form.get("deputy") === "on",
  });
  if (error) failed(form, error.code);
  if (typeof data === "string") await sendAdminWelcome(supabase, data);
  back(form, { done: opened ? "added" : "addedNoAccount" });
}

/** Say yes to somebody who asked from their account page, and give them their duty. */
export async function approveMember(form: FormData) {
  const member = field(form, "member");
  const duty = field(form, "duty");
  if (!UUID.test(member)) back(form, { error: "save" });
  if (duty === "") back(form, { error: "duty" });
  const supabase = await createClient();
  const { error } = await supabase.rpc("approve_admin_member", {
    p_member_id: member,
    p_duty: duty,
  });
  if (error) failed(form, error.code);
  // They signed in with LINE to ask, so this is the message that reaches them.
  await sendAdminWelcome(supabase, member);
  back(form, { done: "approved" });
}

/** Change a row: name, address, phone number, duty. An empty field is left as it was. */
export async function updateMember(form: FormData) {
  const member = field(form, "member");
  if (!UUID.test(member)) back(form, { error: "save" });
  // Empty means "leave the number as it is"; anything else is normalised as above.
  const typed = field(form, "phone");
  const phone = typed === "" ? null : normalizePhone(typed);
  if (typed !== "" && !phone) back(form, { error: "phone" });
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_admin_member", {
    p_member_id: member,
    p_full_name: field(form, "name") || null,
    p_email: field(form, "email").toLowerCase() || null,
    p_phone: phone,
    p_duty: field(form, "duty") || null,
    p_note: null,
  });
  if (error) failed(form, error.code);
  back(form, { done: "saved" });
}

/** Make somebody a deputy super admin, or stop them being one. The super admin alone. */
export async function setDeputy(form: FormData) {
  const member = field(form, "member");
  if (!UUID.test(member)) back(form, { error: "save" });
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_admin_member_deputy", {
    p_member_id: member,
    p_deputy: field(form, "deputy") === "1",
  });
  if (error) failed(form, error.code);
  back(form, { done: "saved" });
}

/** Take the access away. The row stays on the list, marked, with the reason in the log. */
export async function revokeMember(form: FormData) {
  const member = field(form, "member");
  if (!UUID.test(member)) back(form, { error: "save" });
  const supabase = await createClient();
  const { error } = await supabase.rpc("revoke_admin_member", {
    p_member_id: member,
    p_reason: field(form, "reason"),
  });
  if (error) failed(form, error.code);
  back(form, { done: "revoked" });
}
