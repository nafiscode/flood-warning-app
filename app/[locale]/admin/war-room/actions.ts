"use server";

import { after } from "next/server";
import { runPushTick } from "@/lib/push-server";
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
    if (m.includes("heard from")) return "notStale";
    if (m.includes("holds")) return "held";
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
  // The sender is told a team has their case now, not at the next minute's tick (A7).
  after(() => void runPushTick());
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

/**
 * Take a case nobody has heard from in 72 hours off the work list (owner, 27 Nov 2026). The
 * database refuses anything younger, anything a unit holds and anything already closed, and it
 * writes the reason into the case's own history. The case is closed, never deleted, and an admin
 * can reopen it. `all=yes` clears the whole fold at once.
 */
export async function clearStaleCase(locale: string, form: FormData) {
  const sos = field(form, "sos");
  const reason = field(form, "reason");
  const all = field(form, "all") === "yes";
  if (!all && !UUID.test(sos)) back(locale, { error: "save" });
  if (reason === "") back(locale, { error: "reason", ...(all ? {} : { clear: sos }) });
  const supabase = await createClient();
  if (all) {
    const { error } = await supabase.rpc("admin_sos_clear_stale_all", { p_reason: reason });
    if (error) back(locale, { error: why(error) });
    back(locale, { done: "clearedAll" });
  }
  const { error } = await supabase.rpc("admin_sos_clear_stale", {
    p_sos_id: sos,
    p_reason: reason,
  });
  if (error) back(locale, { error: why(error), clear: sos });
  back(locale, { done: "cleared" });
}

/** Undo a clearing: the case comes back to the board (it will sit in the fold again until heard). */
export async function reopenCase(locale: string, form: FormData) {
  const sos = field(form, "sos");
  if (!UUID.test(sos)) back(locale, { error: "save" });
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_sos_reopen", { p_sos_id: sos });
  if (error) back(locale, { error: why(error) });
  back(locale, { done: "reopened", case: sos });
}

/**
 * What an admin did about a dam release notice (spec section 15). It records the judgement and
 * nothing else: sending the notice itself is the rest of A12, and code never sends one at all
 * (safety rule 2). Both answers are kept, dismissals included, because the record of what was
 * decided is the point (spec section 16).
 */
export async function reviewDamNotice(locale: string, form: FormData) {
  const notice = field(form, "notice");
  const status = field(form, "status");
  if (!UUID.test(notice) || (status !== "sent" && status !== "dismissed")) {
    back(locale, { error: "save" });
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_dam_notice_review", {
    p_notice: notice,
    p_status: status,
    p_note: field(form, "note") || null,
  });
  if (error) back(locale, { error: why(error) });
  back(locale, { done: status === "sent" ? "damSent" : "damDismissed" });
}
