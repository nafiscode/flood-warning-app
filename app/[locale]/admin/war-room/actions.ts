"use server";

import { redirect } from "next/navigation";
import { localePath } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * What an admin can do to a case from the war room (spec 6.4). Every one of them is a database
 * function that checks the caller is an admin, writes the step into the case's own history and
 * puts a line in the audit log. None of them can refuse, hide or delete a case (safety rule 1).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function field(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === "string" ? v.trim() : "";
}

/** The locale is bound by the page (`assignCase.bind(null, locale)`), not carried in the form. */
function back(locale: string, params: Record<string, string>): never {
  const path = localePath(locale, "/admin/war-room");
  redirect(`${path}?${new URLSearchParams({ view: "cases", ...params })}`);
}

/** Turn what the database refused into a line the admin can act on. */
function why(error: { code?: string; message?: string } | null): string {
  if (!error) return "save";
  if (error.code === "23505") return "held";
  if (error.code === "42501") return "forbidden";
  if (error.code === "23514") {
    const m = error.message ?? "";
    if (m.includes("closed")) return "closed";
    if (m.includes("cover")) return "notCovered";
    if (m.includes("verified")) return "unverified";
    if (m.includes("reason")) return "reason";
  }
  return "save";
}

export async function assignCase(locale: string, form: FormData) {
  const sos = field(form, "sos");
  const unit = field(form, "unit");
  if (!UUID.test(sos) || !UUID.test(unit)) back(locale, { error: "save" });
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_sos_assign", {
    p_sos_id: sos,
    p_unit_id: unit,
    p_note: field(form, "note") || null,
  });
  if (error) back(locale, { error: why(error), assign: sos });
  back(locale, { done: "assigned" });
}

export async function releaseCase(locale: string, form: FormData) {
  const sos = field(form, "sos");
  const reason = field(form, "reason");
  if (!UUID.test(sos)) back(locale, { error: "save" });
  if (reason === "") back(locale, { error: "reason", release: sos });
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_sos_release", { p_sos_id: sos, p_reason: reason });
  if (error) back(locale, { error: why(error), release: sos });
  back(locale, { done: "released" });
}

export async function noteCase(locale: string, form: FormData) {
  const sos = field(form, "sos");
  const note = field(form, "note");
  if (!UUID.test(sos)) back(locale, { error: "save" });
  if (note === "") back(locale, { error: "reason", note: sos });
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_sos_note", { p_sos_id: sos, p_note: note });
  if (error) back(locale, { error: why(error), note: sos });
  back(locale, { done: "noted", case: sos });
}

/** Judge the spam flag, both ways. Reversible, and the case keeps its place in the queue. */
export async function judgeSpam(locale: string, form: FormData) {
  const sos = field(form, "sos");
  if (!UUID.test(sos)) back(locale, { error: "save" });
  const spam = field(form, "spam") === "yes";
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_sos_spam", {
    p_sos_id: sos,
    p_spam: spam,
    p_reason: field(form, "reason") || null,
  });
  if (error) back(locale, { error: why(error), spam: sos });
  back(locale, { done: spam ? "spam" : "spamDismissed" });
}
