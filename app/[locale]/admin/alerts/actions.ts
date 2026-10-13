"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";
import { readAreas, zoneMap } from "@/lib/admin-alerts";
import { areaChoice, chosenTambons, isUuid, updateHours, windowOf } from "@/lib/alert-console";
import { localePath } from "@/lib/auth";
import { inService } from "@/lib/features";
import { pushAlert } from "@/lib/push-server";
import { createClient } from "@/lib/supabase/server";

const HOUR = 3_600_000;

/**
 * Publish an alert (spec 6.2). A person pressed the button: nothing else calls this (safety
 * rule 2). The words are built in the database from the reviewed template, so no message text
 * passes through here at all; the database also checks the caller is an admin, that the area and
 * the next-update time are there, and that Evacuate was confirmed a second time.
 *
 * Until the service is switched on at launch an alert is a drill, which the public cannot see,
 * unless the admin chose "real alert" at the review step (the owner, 13 Oct: real alerts may be
 * tested before launch). Drill is the default, so a real one is always a deliberate choice.
 */
export async function publishAlert(locale: string, form: FormData) {
  const supersedes = isUuid(form.get("supersedes")) ? String(form.get("supersedes")) : null;
  const back = `${localePath(locale, "/admin/alerts/new")}?${supersedes ? `supersedes=${supersedes}&` : ""}error=`;

  const template = form.get("template");
  if (!isUuid(template)) redirect(`${back}template`);
  const hours = updateHours(form.get("hours"));
  if (hours === null) redirect(`${back}nextUpdate`);
  const onset = windowOf(form.get("onsetFrom"), form.get("onsetTo"));
  const returning = windowOf(form.get("returnFrom"), form.get("returnTo"));
  if (!onset.ok || !returning.ok) redirect(`${back}window`);

  const areas = await readAreas();
  const tambons = chosenTambons(
    areas.tambons.map((t) => t.code),
    areaChoice((name) => form.getAll(name)),
    zoneMap(areas),
  );
  if (tambons.length === 0) redirect(`${back}area`);

  // Once the service is on, every new alert is real. Before that the admin chooses at the review
  // step, and anything but an explicit "real" is a drill. A replacement keeps the kind of the
  // alert it replaces; the database refuses a mismatch.
  const mode = form.get("mode");
  const drill = supersedes ? mode === "drill" : inService() ? false : mode !== "real";

  const supabase = await createClient();
  const { data: published, error } = await supabase.rpc("admin_publish_alert", {
    p_template: template,
    p_tambons: tambons,
    p_next_update_at: new Date(Date.now() + hours * HOUR).toISOString(),
    p_note: String(form.get("note") ?? "").trim() || null,
    p_onset_from: onset.range?.[0] ?? null,
    p_onset_to: onset.range?.[1] ?? null,
    p_return_from: returning.range?.[0] ?? null,
    p_return_to: returning.range?.[1] ?? null,
    p_supersedes: supersedes,
    p_drill: drill,
    p_confirm_evacuate: form.get("confirmEvacuate") === "yes",
  });
  if (error) {
    const why =
      error.code === "P0002"
        ? "gone"
        : error.message.includes("Evacuate")
          ? "evacuate"
          : error.message.includes("replace each other")
            ? "drillMix"
            : "save";
    redirect(`${back}${why}`);
  }
  /*
   * The phones following these tambons are told (A7). After the answer has gone back to the
   * admin, so a slow push service never holds up the publishing; a drill is not pushed, and the
   * alert stands in the app, on the map and in the bell whether or not a notification leaves.
   */
  if (!drill && typeof published === "string") {
    after(async () => {
      await pushAlert(supabase, published);
    });
  }
  redirect(`${localePath(locale, "/admin/alerts")}?done=published`);
}

/** "Nothing has changed; we will look again in ...": moves only the next-update time. */
export async function extendAlert(locale: string, form: FormData) {
  const back = localePath(locale, "/admin/alerts");
  const id = form.get("alert");
  const hours = updateHours(form.get("hours"));
  if (!isUuid(id) || hours === null) redirect(`${back}?error=save`);
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_extend_alert", {
    p_alert: id,
    p_next_update_at: new Date(Date.now() + hours * HOUR).toISOString(),
    p_note: String(form.get("note") ?? "").trim() || null,
  });
  if (error) redirect(`${back}?error=${error.code === "P0002" ? "gone" : "save"}`);
  redirect(`${back}?done=extended`);
}

/** Withdraw an alert. A reason is required: it is the only record of why people were un-warned. */
export async function cancelAlert(locale: string, form: FormData) {
  const back = localePath(locale, "/admin/alerts");
  const id = form.get("alert");
  const note = String(form.get("note") ?? "")
    .trim()
    .slice(0, 400);
  if (!isUuid(id)) redirect(`${back}?error=save`);
  if (note === "") redirect(`${back}?error=reason`);
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_cancel_alert", { p_alert: id, p_note: note });
  if (error) redirect(`${back}?error=${error.code === "P0002" ? "gone" : "save"}`);
  redirect(`${back}?done=cancelled`);
}
