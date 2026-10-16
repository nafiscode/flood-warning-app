"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";
import { runPushTick } from "@/lib/push-server";
import { localePath } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function field(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === "string" ? v.trim() : "";
}

function back(form: FormData, params: Record<string, string>): never {
  const path = localePath(field(form, "locale"), "/admin/authorities");
  redirect(`${path}?${new URLSearchParams(params)}`);
}

/**
 * Verify a unit. The database function checks that the caller is an admin and refuses unless
 * the contact phone is confirmed: by OTP, or by the admin ticking "I called this number".
 */
export async function verifyUnit(form: FormData) {
  const unit = field(form, "unit");
  if (!UUID.test(unit)) back(form, { error: "save" });
  const supabase = await createClient();
  const { error } = await supabase.rpc("verify_authority_unit", {
    p_unit_id: unit,
    p_phone_confirmed_by_call: field(form, "called") === "yes",
  });
  if (error) back(form, { error: error.code === "23514" ? "call" : "save", reveal: unit });
  // The team's LINE hears of it at once (owner, 15 Oct); the minute's cron is the backstop.
  after(runPushTick);
  back(form, { done: "verified" });
}

/**
 * Turn a registration down (owner, 16 Oct 2026): a test registration, or somebody trying the app
 * out. The reason is not an internal note - the team is told it, in the bell and in LINE - so the
 * database function refuses an empty one, and refuses a registration that is no longer waiting.
 */
export async function rejectUnit(form: FormData) {
  const unit = field(form, "unit");
  if (!UUID.test(unit)) back(form, { error: "save" });
  const reason = field(form, "reason");
  if (reason.length < 3) back(form, { error: "reason", reject: unit });
  const supabase = await createClient();
  const { error } = await supabase.rpc("reject_authority_unit", {
    p_unit_id: unit,
    p_reason: reason,
  });
  if (error) back(form, { error: error.code === "23514" ? "reason" : "save", reject: unit });
  // The team's LINE hears of it at once; the minute's cron is the backstop.
  after(runPushTick);
  back(form, { done: "rejected" });
}

export async function suspendUnit(form: FormData) {
  const unit = field(form, "unit");
  if (!UUID.test(unit)) back(form, { error: "save" });
  const supabase = await createClient();
  const { error } = await supabase.rpc("suspend_authority_unit", {
    p_unit_id: unit,
    p_reason: field(form, "reason"),
  });
  if (error) back(form, { error: "save" });
  after(runPushTick);
  back(form, { done: "suspended" });
}
