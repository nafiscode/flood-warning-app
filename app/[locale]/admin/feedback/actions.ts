"use server";

import { redirect } from "next/navigation";
import { localePath } from "@/lib/auth";
import { FEEDBACK_STATUSES, PUBLIC_STATUSES } from "@/lib/feedback";
import { createClient } from "@/lib/supabase/server";

/**
 * The writes of /admin/feedback (A15, spec 17 item 7). Each goes through a database function that
 * checks the caller is an admin and writes the act to the access log; this file only reads the
 * form and says where to go back to.
 *
 * Nothing here edits what somebody wrote. An admin may triage it, say yes or no to showing it,
 * take an approved one back off the page, and write what was done about a weak point - never
 * change a word of a comment. A page of Jaga's own either carries the sender's words or carries
 * nothing (spec 17).
 */

const pick = <T extends string>(list: readonly T[], value: unknown): T | null =>
  list.find((v) => v === value) ?? null;
const words = (form: FormData, name: string, max: number) =>
  String(form.get(name) ?? "")
    .trim()
    .slice(0, max);
const isUuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

/** Where to come back to, keeping whatever the admin was filtering by. */
function back(locale: string, form: FormData): string {
  const query = words(form, "back", 300);
  const base = localePath(locale, "/admin/feedback");
  return query ? `${base}?${query}` : base;
}

export async function triageFeedback(locale: string, form: FormData) {
  const id = form.get("feedback");
  const status = pick(FEEDBACK_STATUSES, form.get("status"));
  const to = back(locale, form);
  if (!isUuid(id) || !status) redirect(`${to}${to.includes("?") ? "&" : "?"}error=save`);
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_feedback_triage", {
    p_id: id,
    p_status: status,
    p_note: words(form, "note", 1000) || null,
    p_change_ref: words(form, "changeRef", 200) || null,
  });
  redirect(`${to}${to.includes("?") ? "&" : "?"}${error ? "error=save" : "saved=triage"}`);
}

export async function publishFeedback(locale: string, form: FormData) {
  const id = form.get("feedback");
  const status = pick(PUBLIC_STATUSES, form.get("to"));
  const to = back(locale, form);
  // "not_requested" is the sender's own answer and can never be set here (the database refuses
  // it too); the console offers approve, refuse and take-off-the-page only.
  if (!isUuid(id) || !status || status === "not_requested") {
    redirect(`${to}${to.includes("?") ? "&" : "?"}error=save`);
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_feedback_publish", { p_id: id, p_to: status });
  redirect(`${to}${to.includes("?") ? "&" : "?"}${error ? "error=save" : `saved=${status}`}`);
}

export async function saveFeedbackOutcome(locale: string, form: FormData) {
  const code = words(form, "code", 40);
  const to = back(locale, form);
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_feedback_outcome", {
    p_code: code,
    p_th: words(form, "th", 500) || null,
    p_ms: words(form, "ms", 500) || null,
    p_en: words(form, "en", 500) || null,
    p_change_ref: words(form, "changeRef", 200) || null,
  });
  redirect(`${to}${to.includes("?") ? "&" : "?"}${error ? "error=save" : "saved=outcome"}`);
}
