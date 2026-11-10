"use server";

import { redirect } from "next/navigation";
import { localePath } from "@/lib/auth";
import { noteStatus } from "@/lib/highway-paths";
import { createClient } from "@/lib/supabase/server";

/**
 * The one thing an office writes here: its note on a stretch (A19 item 5).
 *
 * Deliberately thin, like the dam operator's actions. Nothing in this file decides who may write:
 * `set_highway_stretch_note` looks the unit up from the account and the stretch's own province,
 * so an office cannot write into another province's record even if every line here were wrong.
 * The write is in `audit_log` under the person's own account.
 */

const STRETCH = /^R[0-9]{5}$/;

export async function saveNote(formData: FormData): Promise<void> {
  const locale = String(formData.get("locale") ?? "th");
  const province = String(formData.get("province") ?? "");
  const stretch = String(formData.get("stretch") ?? "");
  const status = noteStatus(formData.get("status"));
  const note = String(formData.get("note") ?? "").slice(0, 2000);

  const back = (query: string) =>
    redirect(`${localePath(locale, "/authority/highway-paths")}?province=${province}&${query}`);

  if (!STRETCH.test(stretch) || !status) back("error=note");

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_highway_stretch_note", {
    p_stretch: stretch,
    p_status: status,
    p_note: note.trim() === "" ? null : note,
  });
  back(error ? "error=note" : `saved=${stretch}`);
}
