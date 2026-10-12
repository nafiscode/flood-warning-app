"use server";

import { redirect } from "next/navigation";
import { localePath } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * Take an award of points back (spec 5.5). The database function checks the caller is an admin,
 * insists on a reason, refuses a row already taken back, and writes it to the access log. The
 * row itself stays in the ledger: it only stops counting.
 */
export async function revokePoints(locale: string, form: FormData) {
  const back = localePath(locale, "/admin/points");
  const id = Number.parseInt(String(form.get("award") ?? ""), 10);
  const reason = String(form.get("reason") ?? "").trim();
  if (!Number.isFinite(id)) redirect(`${back}?error=save`);
  if (reason === "") redirect(`${back}?error=reason`);
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_revoke_points", {
    p_award_id: id,
    p_reason: reason,
  });
  if (error) {
    redirect(`${back}?error=${error.code === "P0002" ? "gone" : "save"}`);
  }
  redirect(`${back}?done=revoked`);
}
