"use server";

import { redirect } from "next/navigation";
import { localePath } from "@/lib/auth";
import { LEVELS, SIGNAL_KEYS } from "@/lib/signals";
import { createClient } from "@/lib/supabase/server";

/**
 * An admin sets a threshold by hand (spec 6.3; A8). The database function checks the caller is an
 * admin, refuses anything that is not a number above nought, marks the threshold as no longer
 * provisional and writes the change to the access log. Changing a threshold publishes nothing: it
 * only moves the line a suggestion is measured against.
 */
export async function setThreshold(locale: string, form: FormData) {
  const back = localePath(locale, "/admin/signals");
  const zone = String(form.get("zone") ?? "");
  const signal = SIGNAL_KEYS.find((k) => k === form.get("signal"));
  const levels: Record<string, number> = {};
  for (const level of LEVELS) {
    const text = String(form.get(level) ?? "")
      .trim()
      .replace(",", ".");
    if (text === "") continue;
    const value = Number(text);
    if (!Number.isFinite(value) || value <= 0) redirect(`${back}?error=threshold`);
    levels[level] = value;
  }
  if (!/^[0-9a-f-]{36}$/i.test(zone) || !signal || Object.keys(levels).length === 0)
    redirect(`${back}?error=threshold`);
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_threshold", {
    p_zone: zone,
    p_signal: signal,
    p_levels: levels,
  });
  redirect(error ? `${back}?error=threshold` : `${back}?saved=${zone}`);
}
