"use server";

import type { Provider } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { finishSignIn, localePath, requestOrigin, safeNextPath } from "@/lib/auth";
import { lineSignInConfigured, phoneSignInEnabled } from "@/lib/features";
import { normalizePhone } from "@/lib/phone";
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

export async function signInWithLine(form: FormData) {
  if (!supabaseConfigured() || !lineSignInConfigured()) back(form, { error: "unavailable" });
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    // LINE is a custom OAuth2 provider in Supabase Auth (decision 2026-10-05).
    provider: "custom:line" as Provider,
    options: {
      redirectTo: await callbackUrl(form),
      scopes: "openid profile",
      // Offer "add Jaga as a friend" on LINE's consent screen, so alerts can reach the person.
      queryParams: { bot_prompt: "normal" },
    },
  });
  if (error || !data.url) back(form, { error: "line" });
  redirect(data.url);
}

/**
 * Email link for admins. Only addresses the super admin invited have an account, and the reply
 * is the same either way, so the form can't be used to find out who is an admin.
 */
export async function sendEmailLink(form: FormData) {
  const email = field(form, "email").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    back(form, { error: "email" });
  }
  if (!supabaseConfigured()) back(form, { error: "unavailable" });
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo: await callbackUrl(form) },
  });
  if (error?.status === 429) back(form, { error: "rate" });
  back(form, { sent: "email" });
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
