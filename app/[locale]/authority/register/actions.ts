"use server";

import { redirect } from "next/navigation";
import { localePath } from "@/lib/auth";
import { normalizePhone } from "@/lib/phone";
import { createClient } from "@/lib/supabase/server";

const ORG_TYPES = ["government", "private", "nonprofit", "volunteer"];
const CAPABILITIES = ["coordination", "rescue", "planning", "support"];

function field(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === "string" ? v.trim() : "";
}

function codes(form: FormData, name: string, digits: number): string[] {
  const pattern = new RegExp(`^[0-9]{${digits}}$`);
  return form.getAll(name).filter((v): v is string => typeof v === "string" && pattern.test(v));
}

/**
 * Register an authority unit. The database function creates it as pending and expands the
 * coverage to tambons; nothing here (or anywhere in the client) can set the status.
 */
export async function registerAuthority(form: FormData) {
  const locale = field(form, "locale");
  const fail: (error: string) => never = (error) => {
    redirect(`${localePath(locale, "/authority/register")}?error=${error}`);
  };

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims.sub) {
    redirect(`${localePath(locale, "/sign-in")}?next=${localePath(locale, "/authority/register")}`);
  }

  const orgType = field(form, "orgType");
  const orgName = field(form, "orgName");
  const unitName = field(form, "unitName");
  const pocName = field(form, "pocName");
  if (
    !ORG_TYPES.includes(orgType) ||
    orgName.length < 2 ||
    unitName.length < 2 ||
    pocName.length < 2
  ) {
    fail("required");
  }
  const pocPhone = normalizePhone(field(form, "pocPhone"));
  if (!pocPhone) fail("pocPhone");
  // Office numbers can be short (hotlines) or landlines: digits only, checked by the database.
  const officialPhone = field(form, "officialPhone").replace(/[\s\-().]/g, "");
  if (officialPhone !== "" && !/^\+?[0-9]{3,15}$/.test(officialPhone)) fail("officialPhone");

  const capabilities = form
    .getAll("capability")
    .filter((v): v is string => typeof v === "string" && CAPABILITIES.includes(v));
  if (capabilities.length === 0) fail("capability");

  const coverage = [
    ...codes(form, "province", 2).map((code) => ({ level: "province", code })),
    ...codes(form, "district", 4).map((code) => ({ level: "district", code })),
    ...codes(form, "tambon", 6).map((code) => ({ level: "tambon", code })),
  ];
  if (coverage.length === 0) fail("coverage");

  const { error } = await supabase.rpc("register_authority_unit", {
    p_org_name: orgName,
    p_org_type: orgType,
    p_unit_name: unitName,
    p_official_phone: officialPhone,
    p_public_contact_opt_in: field(form, "publicContact") === "yes",
    p_poc_name: pocName,
    p_poc_phone: pocPhone,
    p_capabilities: capabilities,
    p_coverage: coverage,
  });
  if (error) fail(error.message.includes("at most 5") ? "limit" : "save");
  redirect(`${localePath(locale, "/account")}?registered=1`);
}
