"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { localePath } from "@/lib/auth";
import { meterDef, parseAmount } from "@/lib/plan-limits";
import { createClient } from "@/lib/supabase/server";

/**
 * An admin writes down a number they read on Vercel's or Supabase's own page. The meter must be
 * one the page knows, the amount must parse in that meter's unit, and a date, if given, must be a
 * real day; anything else goes back with an error and nothing is written. The database checks the
 * caller is an admin again and refuses a reading from the future.
 */
export async function addReading(locale: string, form: FormData) {
  const back = localePath(locale, "/admin/plans");
  const def = meterDef(String(form.get("meter") ?? ""));
  if (!def) redirect(`${back}?error=meter#add`);
  const value = parseAmount(String(form.get("value") ?? ""), def.unit);
  if (value === null || !Number.isFinite(value) || value < 0) redirect(`${back}?error=value#add`);
  const resets = String(form.get("resets_on") ?? "").trim();
  if (resets && !/^\d{4}-\d{2}-\d{2}$/.test(resets)) redirect(`${back}?error=date#add`);
  if (resets && Number.isNaN(Date.parse(`${resets}T00:00:00Z`))) redirect(`${back}?error=date#add`);
  const note = String(form.get("note") ?? "")
    .trim()
    .slice(0, 200);
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_plan_add", {
    p_service: def.service,
    p_meter: def.id,
    p_value: value,
    p_resets_on: resets || undefined,
    p_note: note || undefined,
  });
  if (error) redirect(`${back}?error=save#add`);
  revalidatePath(back);
  redirect(`${back}?saved=1`);
}

/** An admin removes a reading they typed by mistake (the super admin: any). */
export async function deleteReading(locale: string, form: FormData) {
  const back = localePath(locale, "/admin/plans");
  const id = Number(form.get("id"));
  if (!Number.isInteger(id) || id <= 0) redirect(`${back}?error=save#history`);
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_plan_delete", { p_id: id });
  revalidatePath(back);
  redirect(error ? `${back}?error=save#history` : `${back}?removed=1#history`);
}
