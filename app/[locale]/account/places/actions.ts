"use server";

import { redirect } from "next/navigation";
import { localePath } from "@/lib/auth";
import { normalizePhone } from "@/lib/phone";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function field(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Add or change a watched place (spec 4.9). Row-level security lets a person write only their
 * own places; the database works out the tambon from the pin, keeps the limit of 10, and refuses
 * a stored phone without the consent time. The person's name and phone are read by nobody else.
 */
export async function savePlace(form: FormData) {
  const locale = field(form, "locale");
  const id = field(form, "id");
  const editing = UUID.test(id);
  const back = localePath(locale, `/account/places/${editing ? id : "new"}`);
  const fail: (error: string) => never = (error) => redirect(`${back}?error=${error}`);

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims.sub;
  if (!userId) redirect(localePath(locale, "/sign-in"));

  const label = field(form, "label");
  if (label.length < 1 || label.length > 60) fail("label");

  const row: Record<string, unknown> = { label, notify: field(form, "notify") === "yes" };
  const lat = Number.parseFloat(field(form, "lat"));
  const lon = Number.parseFloat(field(form, "lon"));
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) fail("location");
    row.point = `SRID=4326;POINT(${lon} ${lat})`;
  } else if (!editing) {
    fail("location");
  }

  const contactName = field(form, "contactName");
  if (contactName.length > 80) fail("name");
  const phoneTyped = field(form, "contactPhone");
  const contactPhone = phoneTyped === "" ? null : normalizePhone(phoneTyped);
  if (phoneTyped !== "" && !contactPhone) fail("phone");
  if (contactName !== "" || contactPhone) {
    // Someone else's name and number: stored only when the person agreed (PDPA).
    if (field(form, "contactConsent") !== "yes") fail("consent");
    row.contact_name = contactName === "" ? null : contactName;
    row.contact_phone = contactPhone;
    row.contact_consent_at = new Date().toISOString();
  } else {
    row.contact_name = null;
    row.contact_phone = null;
    row.contact_consent_at = null;
  }

  const { error } = editing
    ? await supabase
        .from("saved_places")
        .update({ ...row, updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("user_id", userId)
    : await supabase.from("saved_places").insert({ ...row, user_id: userId });
  // The limit of 10 places is a database rule (check_violation).
  if (error) fail(error.code === "23514" && !editing ? "limit" : "save");
  redirect(`${localePath(locale, "/account/places")}?done=saved`);
}

export async function deletePlace(form: FormData) {
  const locale = field(form, "locale");
  const id = field(form, "id");
  const list = localePath(locale, "/account/places");
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims.sub;
  if (!userId) redirect(localePath(locale, "/sign-in"));
  if (!UUID.test(id)) redirect(list);
  const { error } = await supabase.from("saved_places").delete().eq("id", id).eq("user_id", userId);
  if (error) redirect(`${localePath(locale, `/account/places/${id}`)}?error=save`);
  redirect(`${list}?done=deleted`);
}
