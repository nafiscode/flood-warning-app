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

const backTo = (locale: string, form: FormData) =>
  localPath(locale, form.get("view") === "map" ? "/admin/signals?view=map" : "/admin/signals");
const localPath = (locale: string, path: string) => localePath(locale, path);

/**
 * The automated alarm for one gauge, or ("all") for every gauge in a warning zone (the owner's
 * decision of 14 Oct 2026). The database checks the caller is an admin and logs the change.
 */
export async function setAutoAlarm(locale: string, form: FormData) {
  const station = String(form.get("station") ?? "");
  const enabled = form.get("enabled") === "on";
  const all = station === "all";
  if (!all && !/^[0-9a-f-]{36}$/i.test(station))
    redirect(`${localePath(locale, "/admin/signals")}?error=auto`);
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_auto_alarm", {
    p_station: all ? null : station,
    p_enabled: enabled,
  });
  const back = backTo(locale, form);
  redirect(`${back}${back.includes("?") ? "&" : "?"}${error ? "error=auto" : "autosaved=1"}`);
}

/** Drill or real for what the automated alarm publishes. */
export async function setAutoMode(locale: string, form: FormData) {
  const mode = form.get("mode") === "real" ? "real" : "drill";
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_auto_alarm_mode", { p_mode: mode });
  redirect(`${localePath(locale, "/admin/signals")}?${error ? "error=auto" : "autosaved=1"}`);
}

/** Stop a waiting draft from being published by itself. */
export async function dismissAutoAlarm(locale: string, form: FormData) {
  const event = String(form.get("event") ?? "");
  const note = String(form.get("note") ?? "").trim();
  const supabase = await createClient();
  const { error } = /^[0-9a-f-]{36}$/i.test(event)
    ? await supabase.rpc("admin_dismiss_auto_alarm", { p_event: event, p_note: note || null })
    : { error: true };
  redirect(`${localePath(locale, "/admin/signals")}?${error ? "error=auto" : "autosaved=1"}`);
}
