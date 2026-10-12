"use server";

import { redirect } from "next/navigation";
import { localePath } from "@/lib/auth";
import { VULNERABLE_ORDER, cleanCounts } from "@/lib/coverage";
import { normalizePhone } from "@/lib/phone";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function field(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === "string" ? v.trim() : "";
}

type Point = { coordinates?: [number, number] } | null;
const ewkt = (lon: number, lat: number) => `SRID=4326;POINT(${lon} ${lat})`;

/**
 * A household that asks to be known about before a flood (spec 4.7): how many people, how many of
 * them would need help first, and a number to call. One for the person's own home and one for
 * each place they watch for somebody else.
 *
 * This is health-related information, so nothing is stored without the consent tick, and for
 * someone else's home not without the tick that says they agreed (PDPA). Row-level security lets
 * a person write only their own; the database works out the tambon from the point. Who may read
 * it afterwards is decided there too: verified teams with rescue or coordination capability
 * covering that tambon, and admins, each read written to the access log.
 */
export async function saveHousehold(form: FormData) {
  const locale = field(form, "locale");
  const key = field(form, "key");
  const placeId = UUID.test(key) ? key : null;
  if (!placeId && key !== "home") redirect(localePath(locale, "/account"));
  const back = localePath(locale, `/account/household/${key}`);
  const fail: (error: string) => never = (error) => redirect(`${back}?error=${error}`);

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims.sub;
  if (!userId) redirect(localePath(locale, "/sign-in"));

  if (field(form, "consent") !== "yes") fail("consent");
  if (placeId && field(form, "agreed") !== "yes") fail("agreed");

  const size = Number.parseInt(field(form, "size"), 10);
  if (!Number.isFinite(size) || size < 1 || size > 50) fail("size");
  const counts = cleanCounts(
    Object.fromEntries(VULNERABLE_ORDER.map((k) => [k, field(form, `v_${k}`)])),
  );
  const notes = field(form, "notes");
  if (notes.length > 500) fail("notes");
  const phoneTyped = field(form, "phone");
  const phone = phoneTyped === "" ? null : normalizePhone(phoneTyped);
  if (phoneTyped !== "" && !phone) fail("phone");

  // The row this form is about, if there is one already.
  const existing = placeId
    ? await supabase
        .from("households")
        .select("id")
        .eq("owner_id", userId)
        .eq("saved_place_id", placeId)
        .maybeSingle()
    : await supabase
        .from("households")
        .select("id")
        .eq("owner_id", userId)
        .is("saved_place_id", null)
        .maybeSingle();
  const id = (existing.data?.id as string | undefined) ?? null;

  const row: Record<string, unknown> = {
    size,
    vulnerable: counts,
    mobility_notes: notes === "" ? null : notes,
    contact_phone: phone,
    consent_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  if (placeId) {
    // The household is where the watched place is. The place stays private; only its point is
    // copied here, by the person's own choice.
    const place = await supabase
      .from("saved_places")
      .select("point")
      .eq("id", placeId)
      .eq("user_id", userId)
      .maybeSingle();
    const at = (place.data?.point as Point)?.coordinates;
    if (!at) fail("location");
    row.point = ewkt(at![0], at![1]);
    row.saved_place_id = placeId;
    row.on_behalf_of_other = true;
  } else {
    const lat = Number.parseFloat(field(form, "lat"));
    const lon = Number.parseFloat(field(form, "lon"));
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      if (Math.abs(lat) > 90 || Math.abs(lon) > 180) fail("location");
      row.point = ewkt(lon, lat);
    } else if (!id) {
      // No pin given: the home location already on the account, if there is one.
      const profile = await supabase
        .from("profiles")
        .select("home_point")
        .eq("user_id", userId)
        .maybeSingle();
      const at = (profile.data?.home_point as Point)?.coordinates;
      if (!at) fail("location");
      row.point = ewkt(at![0], at![1]);
    }
  }

  const { error } = id
    ? await supabase.from("households").update(row).eq("id", id).eq("owner_id", userId)
    : await supabase.from("households").insert({ ...row, owner_id: userId });
  if (error) fail("save");
  redirect(`${back}?done=saved`);
}

export async function deleteHousehold(form: FormData) {
  const locale = field(form, "locale");
  const key = field(form, "key");
  const id = field(form, "id");
  const back = localePath(locale, `/account/household/${key}`);
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims.sub;
  if (!userId) redirect(localePath(locale, "/sign-in"));
  if (!UUID.test(id)) redirect(back);
  const { error } = await supabase.from("households").delete().eq("id", id).eq("owner_id", userId);
  redirect(`${back}?${error ? "error=save" : "done=deleted"}`);
}
