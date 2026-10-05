"use server";

import { redirect } from "next/navigation";
import { hasLocale } from "next-intl";
import { routing } from "@/i18n/routing";
import { localePath, safeNextPath } from "@/lib/auth";
import { normalizePhone } from "@/lib/phone";
import { createClient } from "@/lib/supabase/server";

function field(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Save the profile: display name (required), phone, language and home location (all optional).
 * The tambon is computed from the point by a database trigger; role is not writable here or
 * anywhere in the client (column grants).
 */
export async function saveProfile(form: FormData) {
  const pageLocale = field(form, "locale");
  const next = safeNextPath(field(form, "next"));
  const fail: (error: string) => never = (error) => {
    const query = new URLSearchParams({ error, ...(next ? { next } : {}) });
    redirect(`${localePath(pageLocale, "/account/setup")}?${query}`);
  };

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims.sub;
  if (!userId) redirect(localePath(pageLocale, "/sign-in"));

  const displayName = field(form, "displayName");
  if (displayName.length < 1 || displayName.length > 80) fail("name");
  const phoneTyped = field(form, "phone");
  const phone = phoneTyped === "" ? null : normalizePhone(phoneTyped);
  if (phoneTyped !== "" && !phone) fail("phone");
  const language = field(form, "language");
  const preferred = hasLocale(routing.locales, language) ? language : routing.defaultLocale;

  const update: Record<string, unknown> = {
    display_name: displayName,
    preferred_locale: preferred,
  };
  const lat = Number.parseFloat(field(form, "lat"));
  const lon = Number.parseFloat(field(form, "lon"));
  const hasPoint = Number.isFinite(lat) && Number.isFinite(lon);
  if (hasPoint) {
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) fail("location");
    // Storing a home location needs the person's consent (PDPA); kept with its timestamp.
    if (field(form, "locationConsent") !== "yes") fail("consent");
    update.home_point = `SRID=4326;POINT(${lon} ${lat})`;
    const { data: current } = await supabase
      .from("profiles")
      .select("consents")
      .eq("user_id", userId)
      .maybeSingle();
    update.consents = { ...(current?.consents ?? {}), location: new Date().toISOString() };
  } else if (field(form, "removeHome") === "yes") {
    update.home_point = null;
  }

  const { error } = await supabase.from("profiles").update(update).eq("user_id", userId);
  if (error) fail("save");

  if (phone) {
    // Not an upsert: clients may write only the phone column; "verified" is set by the database.
    const { data: updated, error: updateError } = await supabase
      .from("profile_contacts")
      .update({ phone })
      .eq("user_id", userId)
      .select("user_id");
    if (updateError) fail("save");
    if (!updated || updated.length === 0) {
      const { error: insertError } = await supabase
        .from("profile_contacts")
        .insert({ user_id: userId, phone });
      if (insertError) fail("save");
    }
  } else {
    await supabase.from("profile_contacts").delete().eq("user_id", userId);
  }
  if (next) redirect(next);
  const { data: saved } = await supabase
    .from("profiles")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();
  const isAdmin = saved?.role === "admin" || saved?.role === "super_admin";
  redirect(localePath(preferred, isAdmin ? "/admin" : "/account"));
}
