"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";
import { localePath } from "@/lib/auth";
import { normalizePhone } from "@/lib/phone";
import { runPushTick } from "@/lib/push-server";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ORG_TYPES = ["government", "private", "nonprofit", "volunteer"];
const CAPABILITIES = ["coordination", "rescue", "supplies", "planning", "support", "dam"];

function field(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === "string" ? v.trim() : "";
}

function codes(form: FormData, name: string, digits: number): string[] {
  const pattern = new RegExp(`^[0-9]{${digits}}$`);
  return form.getAll(name).filter((v): v is string => typeof v === "string" && pattern.test(v));
}

/** Back to the unit's edit page with the result. Every failure comes back here, never to a blank. */
function back(form: FormData, params: Record<string, string>): never {
  const unit = field(form, "unit");
  const path = localePath(field(form, "locale"), `/admin/authorities/${unit}/edit`);
  redirect(`${path}?${new URLSearchParams(params)}`);
}

/**
 * The three forms on the edit page (admin only, owner 26 Nov 2026). Each saves on its own and
 * calls one database function, which checks the caller is an admin, checks the values again, and
 * writes the audit-log entry. Nothing here can touch the unit's status.
 *
 * Each form carries a "tell the team" box, ticked when the page is drawn (owner, 26 Nov 2026: the
 * admin may untick it, and by default the team is told). When it is ticked the team's LINE hears
 * at once and the minute's cron is the backstop, as for a verification.
 */

/** Ticked boxes send "yes"; a form that never had the box tells nobody, the harmless direction. */
function notifyTeam(form: FormData): boolean {
  return field(form, "notify") === "yes";
}

export async function saveUnitDetails(form: FormData) {
  const unit = field(form, "unit");
  if (!UUID.test(unit)) back(form, { error: "save" });
  const orgType = field(form, "orgType");
  const unitName = field(form, "unitName");
  const orgName = field(form, "orgName");
  if (!ORG_TYPES.includes(orgType) || unitName.length < 2 || orgName.length < 2) {
    back(form, { error: "required" });
  }
  // Office numbers can be short (hotlines) or landlines: digits only, checked again by the database.
  const officialPhone = field(form, "officialPhone").replace(/[\s\-().]/g, "");
  if (officialPhone !== "" && !/^\+?[0-9]{3,15}$/.test(officialPhone)) {
    back(form, { error: "officialPhone" });
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_update_unit_details", {
    p_unit: unit,
    p_unit_name: unitName,
    p_org_name: orgName,
    p_org_type: orgType,
    p_official_phone: officialPhone,
    p_public_contact_opt_in: field(form, "publicContact") === "yes",
    p_notify_team: notifyTeam(form),
  });
  if (error) back(form, { error: "save" });
  if (notifyTeam(form)) after(runPushTick);
  back(form, { done: "details" });
}

export async function saveUnitContact(form: FormData) {
  const unit = field(form, "unit");
  if (!UUID.test(unit)) back(form, { error: "save" });
  const pocName = field(form, "pocName");
  if (pocName.length < 2) back(form, { error: "required", reveal: "1" });
  const pocPhone = normalizePhone(field(form, "pocPhone"));
  if (!pocPhone) back(form, { error: "pocPhone", reveal: "1" });
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_update_unit_contact", {
    p_unit: unit,
    p_poc_name: pocName,
    p_poc_phone: pocPhone,
    p_phone_confirmed_by_call: field(form, "called") === "yes",
    p_notify_team: notifyTeam(form),
  });
  // A verified team's new number is only saved once the admin says they called it.
  if (error) {
    back(form, {
      error: error.message.includes("Call the new number") ? "call" : "save",
      reveal: "1",
    });
  }
  if (notifyTeam(form)) after(runPushTick);
  back(form, { done: "contact" });
}

export async function saveUnitScope(form: FormData) {
  const unit = field(form, "unit");
  if (!UUID.test(unit)) back(form, { error: "save" });
  const capabilities = form
    .getAll("capability")
    .filter((v): v is string => typeof v === "string" && CAPABILITIES.includes(v));
  if (capabilities.length === 0) back(form, { error: "capability" });
  const coverage = [
    ...codes(form, "province", 2).map((code) => ({ level: "province", code })),
    ...codes(form, "district", 4).map((code) => ({ level: "district", code })),
    ...codes(form, "tambon", 6).map((code) => ({ level: "tambon", code })),
  ];
  if (coverage.length === 0) back(form, { error: "coverage" });
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_update_unit_scope", {
    p_unit: unit,
    p_capabilities: capabilities,
    p_coverage: coverage,
    p_confirm_open_cases: field(form, "confirmOpen") === "yes",
    p_notify_team: notifyTeam(form),
  });
  if (error) {
    // The database refuses a change that would cut the team off from a case it has accepted and
    // is still working, unless the admin ticked that they understand. The page asks first when
    // it can; this is for a page without scripts, or one that was open while a case was accepted.
    back(form, {
      error: error.message.includes("Open cases")
        ? "open"
        : error.message.includes("outside the provinces")
          ? "coverage"
          : "save",
    });
  }
  if (notifyTeam(form)) after(runPushTick);
  back(form, { done: "scope" });
}
