"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { finishSignIn, localePath, requestOrigin, safeNextPath } from "@/lib/auth";
import { phoneSignInEnabled } from "@/lib/features";
import { normalizePhone } from "@/lib/phone";
import { gateToken } from "@/lib/push-server";
import { supabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

function field(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === "string" ? v.trim() : "";
}

/** Back to the sign-in page in the same language, with a short code the page turns into text. */
function back(form: FormData, params: Record<string, string>): never {
  const next = safeNextPath(field(form, "next"));
  const query = new URLSearchParams({ ...params, ...(next ? { next } : {}) });
  redirect(`${localePath(field(form, "locale"), "/sign-in")}?${query}`);
}

async function callbackUrl(form: FormData): Promise<string> {
  const next = safeNextPath(field(form, "next"));
  const origin = await requestOrigin();
  return `${origin}/api/auth/callback${next ? `?next=${encodeURIComponent(next)}` : ""}`;
}

/** The caller's internet address as Vercel passes it on, for the per-address limit. */
async function callerIp(): Promise<string | null> {
  const h = await headers();
  const first = (h.get("x-forwarded-for") ?? h.get("x-real-ip") ?? "").split(",")[0]?.trim() ?? "";
  return /^[0-9a-f.:]{3,45}$/i.test(first) ? first : null;
}

/**
 * At most 5 links an hour to one address and 30 from one internet address (A10 security review),
 * so a script cannot flood an admin's inbox or use up the project's email allowance. Asked with
 * the server's own token; if the check itself fails, the link is sent, because an admin who
 * cannot sign in during a flood cannot publish alerts.
 */
async function emailLinkAllowed(
  supabase: Awaited<ReturnType<typeof createClient>>,
  email: string,
): Promise<boolean> {
  const token = gateToken();
  if (!token) return true;
  const { data, error } = await supabase.rpc("email_link_allowed", {
    p_token: token,
    p_email: email,
    p_ip: await callerIp(),
  });
  return error ? true : data !== false;
}

/**
 * At most 10 tries an hour at one address's code and 60 from one internet address, in a log of
 * their own (migration a10_email_code_tries) so a mistyped code never uses up the budget for
 * sending a link. Fails open for the same reason as the sends.
 */
async function emailCodeAllowed(
  supabase: Awaited<ReturnType<typeof createClient>>,
  email: string,
): Promise<boolean> {
  const token = gateToken();
  if (!token) return true;
  const { data, error } = await supabase.rpc("email_code_allowed", {
    p_token: token,
    p_email: email,
    p_ip: await callerIp(),
  });
  return error ? true : data !== false;
}

/**
 * Email code and link for admins. Only addresses the super admin invited have an account, and
 * the reply is the same either way, so the form can't be used to find out who is an admin.
 *
 * The code is what the form then asks for: a link opens the phone's browser, which on an iPhone
 * shares no cookies with Jaga on the home screen, so the admin was left signed in everywhere
 * but in the app (owner, 2026-10-18). The link is still in the email for a computer.
 */
export async function sendEmailLink(form: FormData) {
  const email = field(form, "email").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    back(form, { error: "email" });
  }
  if (!supabaseConfigured()) back(form, { error: "unavailable" });
  const supabase = await createClient();
  if (!(await emailLinkAllowed(supabase, email))) back(form, { step: "emailCode", email, error: "rate" });
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo: await callbackUrl(form) },
  });
  // Refused for being asked too often: still show the box for the code, because an email sent
  // a few minutes ago carries one that is good for an hour. An admin in a flood must be able to
  // use what they already have instead of starting again.
  if (error?.status === 429) back(form, { step: "emailCode", email, error: "rate" });
  back(form, { sent: "email", step: "emailCode", email });
}

/**
 * The 6-digit code from that email, typed into Jaga itself: the session is made right here, in
 * whichever Jaga the person is holding, home-screen app or browser alike.
 */
export async function verifyEmailCode(form: FormData) {
  const email = field(form, "email").toLowerCase();
  const code = field(form, "code").replace(/\s/g, "");
  const again = (error: string) => back(form, { step: "emailCode", email, error });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) back(form, { error: "email" });
  if (!/^[0-9]{6,10}$/.test(code)) again("code");
  if (!supabaseConfigured()) back(form, { error: "unavailable" });
  const supabase = await createClient();
  if (!(await emailCodeAllowed(supabase, email))) again("rate");
  const { error } = await supabase.auth.verifyOtp({ email, token: code, type: "email" });
  if (error) again(error.status === 429 ? "rate" : "code");
  redirect(await finishSignIn(supabase, safeNextPath(field(form, "next"))));
}

export async function sendPhoneCode(form: FormData) {
  if (!supabaseConfigured() || !phoneSignInEnabled()) back(form, { error: "unavailable" });
  const phone = normalizePhone(field(form, "phone"));
  if (!phone) back(form, { error: "phone" });
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({ phone });
  if (error) back(form, { error: error.status === 429 ? "rate" : "sms" });
  back(form, { step: "code", phone });
}

export async function verifyPhoneCode(form: FormData) {
  if (!supabaseConfigured() || !phoneSignInEnabled()) back(form, { error: "unavailable" });
  const phone = normalizePhone(field(form, "phone"));
  const token = field(form, "code").replace(/\s/g, "");
  if (!phone) back(form, { error: "phone" });
  if (!/^[0-9]{4,8}$/.test(token)) back(form, { step: "code", phone, error: "code" });
  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ phone, token, type: "sms" });
  if (error) back(form, { step: "code", phone, error: "code" });
  redirect(await finishSignIn(supabase, safeNextPath(field(form, "next"))));
}
