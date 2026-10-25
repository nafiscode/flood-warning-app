"use server";

import { after } from "next/server";
import { pushAnnouncement, runPushTick } from "@/lib/push-server";
import { redirect } from "next/navigation";
import { readAreas, zoneMap } from "@/lib/admin-alerts";
import {
  ANNOUNCE_HOURS,
  MODERATION,
  PLACE_STATUS,
  PLACE_TYPES,
  PLACE_VERIFICATION,
} from "@/lib/admin-tools";
import { areaChoice, chosenTambons, isUuid } from "@/lib/alert-console";
import { localePath } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * The writes of the rest of the admin console (spec 6.4, 6.5). Each goes through a database
 * function that checks the caller is an admin and writes the act to the access log; this file
 * only reads the form and says where to go next.
 */

const pick = <T extends string>(list: readonly T[], value: unknown): T | null =>
  list.find((v) => v === value) ?? null;
const words = (form: FormData, name: string, max: number) =>
  String(form.get(name) ?? "")
    .trim()
    .slice(0, max);

export async function moderateReport(locale: string, form: FormData) {
  const id = form.get("report");
  const to = pick(MODERATION, form.get("to"));
  const from = pick(MODERATION, form.get("from")) ?? "pending";
  const back = `${localePath(locale, "/admin/moderation")}?status=${from}`;
  if (!isUuid(id) || !to) redirect(`${back}&error=save`);
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_moderate_report", { p_report: id, p_status: to });
  // The reporter hears of it in LINE at once (owner, 15 Oct); the minute's cron is the backstop.
  if (!error) after(runPushTick);
  redirect(error ? `${back}&error=save` : `${back}&done=${to}`);
}

export async function updateSafePlace(locale: string, form: FormData) {
  const district = words(form, "district", 4);
  const back = `${localePath(locale, "/admin/safe-places")}?district=${encodeURIComponent(district)}`;
  const id = form.get("place");
  const status = pick(PLACE_STATUS, form.get("status"));
  const verification = pick(PLACE_VERIFICATION, form.get("verification"));
  const nameTh = words(form, "nameTh", 200);
  const capacityText = words(form, "capacity", 8);
  const capacity = capacityText === "" ? null : Number.parseInt(capacityText, 10);
  if (!isUuid(id) || !status || !verification) redirect(`${back}&error=save`);
  if (nameTh === "") redirect(`${back}&error=name`);
  if (capacity !== null && (!Number.isFinite(capacity) || capacity < 0))
    redirect(`${back}&error=capacity`);
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_safe_place_update", {
    p_place: id,
    p_name_th: nameTh,
    p_name_en: words(form, "nameEn", 200) || null,
    p_capacity: capacity,
    p_needs: words(form, "needs", 500) || null,
    p_status: status,
    p_verification: verification,
  });
  redirect(error ? `${back}&error=save` : `${back}&done=saved#place-${id}`);
}

export async function addSafePlace(locale: string, form: FormData) {
  const back = localePath(locale, "/admin/safe-places");
  const type = pick(PLACE_TYPES, form.get("type"));
  const nameTh = words(form, "nameTh", 200);
  const lat = Number(words(form, "lat", 20));
  const lon = Number(words(form, "lon", 20));
  const capacityText = words(form, "capacity", 8);
  if (!type || nameTh === "") redirect(`${back}?error=name`);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || words(form, "lat", 20) === "")
    redirect(`${back}?error=position`);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_safe_place_add", {
    p_name_th: nameTh,
    p_name_en: words(form, "nameEn", 200) || null,
    p_type: type,
    p_lat: lat,
    p_lon: lon,
    p_capacity: capacityText === "" ? null : Number.parseInt(capacityText, 10) || null,
    p_verified: form.get("verified") === "yes",
  });
  if (error || typeof data !== "string") {
    redirect(`${back}?error=${error?.message.includes("not inside") ? "outside" : "save"}`);
  }
  // Back to the district the new place fell in, so it is on the screen.
  const { data: place } = await supabase
    .from("safe_places")
    .select("tambon")
    .eq("id", data)
    .maybeSingle();
  const district = typeof place?.tambon === "string" ? place.tambon.slice(0, 4) : "";
  redirect(`${back}?district=${district}&done=added#place-${data}`);
}

export async function addHandoverNote(locale: string, form: FormData) {
  const back = localePath(locale, "/admin/handover");
  const note = words(form, "note", 4000);
  if (note === "") redirect(`${back}?error=empty`);
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) redirect(`${back}?error=save`);
  const { error } = await supabase.from("handover_notes").insert({ author_id: user.user.id, note });
  redirect(error ? `${back}?error=save` : `${back}?done=saved`);
}

export async function postAnnouncement(locale: string, form: FormData) {
  const back = localePath(locale, "/admin/announcements");
  const th = words(form, "th", 600);
  if (th === "") redirect(`${back}?error=thai`);
  const messages: Record<string, string> = { th };
  for (const other of ["ms", "en"] as const) {
    const value = words(form, other, 600);
    if (value !== "") messages[other] = value;
  }
  const hours = Number(form.get("hours"));
  if (!(ANNOUNCE_HOURS as readonly number[]).includes(hours)) redirect(`${back}?error=save`);
  const cta = form.get("cta") === "share_app" ? "share_app" : null;

  const supabase = await createClient();
  const scope = form.get("scope");
  let tambons: string[] | null = null;
  if (scope === "area") {
    const areas = await readAreas();
    tambons = chosenTambons(
      areas.tambons.map((t) => t.code),
      areaChoice((name) => form.getAll(name)),
      zoneMap(areas),
    );
    if (tambons.length === 0) redirect(`${back}?error=area`);
    // The table holds at most 500 codes; more than that is "everyone" in all but name.
    if (tambons.length > 500) tambons = null;
  } else if (scope === "noTeam") {
    // Every tambon in the service area that still has no verified unit covering it, worked out in
    // the database so the browser never sees where people live. Empty means every area already has
    // a team - there is nothing to send. The 377 service tambons fit well under the table's 500.
    const { data, error } = await supabase.rpc("admin_tambons_without_team");
    if (error) redirect(`${back}?error=save`);
    tambons = (Array.isArray(data) ? data : []).map(String).filter((c) => /^[0-9]{6}$/.test(c));
    if (tambons.length === 0) redirect(`${back}?error=noTeam`);
    if (tambons.length > 500) tambons = tambons.slice(0, 500);
  }
  const { data: posted, error } = await supabase.rpc("admin_announce", {
    p_messages: messages,
    p_tambons: tambons,
    p_ends_at: hours === 0 ? null : new Date(Date.now() + hours * 3_600_000).toISOString(),
    p_cta: cta,
  });
  // The phones it is for are told (A7), after this page has answered. It is in the bell either way.
  if (!error && typeof posted === "string") {
    after(async () => {
      await pushAnnouncement(supabase, posted, messages);
    });
  }
  redirect(error ? `${back}?error=save` : `${back}?done=posted`);
}

export async function cancelAnnouncement(locale: string, form: FormData) {
  const back = localePath(locale, "/admin/announcements");
  const id = form.get("announcement");
  if (!isUuid(id)) redirect(`${back}?error=save`);
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_announce_cancel", { p_id: id });
  redirect(error ? `${back}?error=save` : `${back}?done=cancelled`);
}

export async function mergeSos(locale: string, form: FormData) {
  const back = localePath(locale, "/admin/duplicates");
  const duplicate = form.get("duplicate");
  const into = form.get("into");
  if (!isUuid(duplicate) || !isUuid(into)) redirect(`${back}?error=save`);
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_sos_merge", {
    p_duplicate: duplicate,
    p_into: into,
    p_note: words(form, "note", 500) || null,
  });
  if (error) {
    const why = error.message.includes("team holds")
      ? "held"
      : error.code === "23514"
        ? "refused"
        : "save";
    redirect(`${back}?error=${why}`);
  }
  redirect(`${back}?done=merged`);
}

export async function unmergeSos(locale: string, form: FormData) {
  const back = localePath(locale, "/admin/duplicates");
  const id = form.get("sos");
  if (!isUuid(id)) redirect(`${back}?error=save`);
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_sos_unmerge", { p_sos: id });
  redirect(error ? `${back}?error=save` : `${back}?done=unmerged`);
}

/**
 * An admin's decision on a rescue a team found by itself: approve a held one (the half points
 * are awarded), or refuse one with a reason - which also takes back the points of one that had
 * been counted automatically. Checked and logged by the database function.
 */
export async function reviewFieldRescue(locale: string, form: FormData) {
  const from = String(form.get("from") ?? "pending").replace(/[^a-z]/g, "");
  const back = `${localePath(locale, "/admin/field-rescues")}?status=${from}`;
  const id = form.get("rescue");
  const approve = form.get("decision") === "approve";
  const note = words(form, "note", 500);
  if (!isUuid(id)) redirect(`${back}&error=save`);
  if (!approve && note === "") redirect(`${back}&error=reason`);
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_review_field_rescue", {
    p_rescue: id,
    p_approve: approve,
    p_note: note || null,
  });
  if (error) redirect(`${back}&error=${error.code === "23514" ? "gone" : "save"}`);
  // The team hears of it in LINE at once (owner, 15 Oct); the minute's cron is the backstop.
  after(runPushTick);
  redirect(`${back}&done=${approve ? "approved" : "rejected"}`);
}
