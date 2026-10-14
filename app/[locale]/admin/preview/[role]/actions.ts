"use server";

import { redirect } from "next/navigation";
import { localePath } from "@/lib/auth";

/**
 * The dam operator preview's send button. It sends nothing, reads nothing and writes nothing: it
 * only brings the admin back to the preview with a line saying what the real screen would have
 * done. The real operator screen will call its own database function, behind a verified unit.
 */
export async function previewOperatorSend(locale: string, _form: FormData): Promise<void> {
  void _form;
  redirect(`${localePath(locale, "/admin/preview/operator")}?sent=1`);
}
