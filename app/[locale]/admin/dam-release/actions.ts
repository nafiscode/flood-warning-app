"use server";

import { redirect } from "next/navigation";
import { createTranslator } from "next-intl";
import { routing } from "@/i18n/routing";
import { localePath } from "@/lib/auth";
import type { DamArrival } from "@/lib/dam-arrival";
import {
  bangkokInput,
  isReleaseLevel,
  releaseReason,
  releaseText,
  zoneWindow,
  type ReleaseInput,
} from "@/lib/dam-release";
import { localName } from "@/lib/places";
import { createClient } from "@/lib/supabase/server";
import { BANGKOK_DATE_TIME } from "@/lib/time";

/**
 * Sending the dam release notice (docs/spec.md section 15).
 *
 * The action does two things and nothing else: it builds the reviewed template in all three
 * languages, and it hands the figures to `admin_send_dam_release`, which checks the caller is an
 * admin, draws the zone from S7 and writes the send to the access log. Every judgement in between
 * - whether to send at all, and at which level - belongs to the person pressing the button
 * (safety rule 2).
 */
async function textsFor(
  dam: { name: Record<string, string>; river: Record<string, string>; operator: string },
  figures: Omit<ReleaseInput, "damName" | "river" | "operator">,
): Promise<{ messages: Record<string, string>; reason: string }> {
  const messages: Record<string, string> = {};
  let reason = "";
  for (const locale of routing.locales) {
    const loaded = (await import(`../../../../messages/${locale}.json`)).default;
    const say = createTranslator({ locale, messages: loaded, namespace: "dam" });
    const time = (at: Date) =>
      new Intl.DateTimeFormat(locale, BANGKOK_DATE_TIME).format(at).replace(/‏/g, "");
    const input: ReleaseInput = {
      ...figures,
      damName: localName(dam.name, locale),
      river: localName(dam.river, locale),
      operator: dam.operator,
    };
    messages[locale] = releaseText(say, time, input);
    // Thai is the source of truth for copy, so the one stored reason line is the Thai one.
    if (locale === routing.defaultLocale) reason = releaseReason(say, time, input);
  }
  return { messages, reason };
}

export async function sendDamRelease(locale: string, form: FormData) {
  const back = localePath(locale, "/admin/dam-release");
  const code = String(form.get("dam") ?? "").trim();
  const gatesOpenAt = bangkokInput(String(form.get("gatesOpenAt") ?? ""));
  const expectedEndAt = bangkokInput(String(form.get("expectedEnd") ?? ""));
  const nextUpdateAt = bangkokInput(String(form.get("nextUpdate") ?? ""));
  const level = String(form.get("level") ?? "");
  const releaseCms = Number.parseFloat(String(form.get("releaseCms") ?? ""));
  const notice = String(form.get("notice") ?? "").trim();

  if (
    code === "" ||
    !gatesOpenAt ||
    !nextUpdateAt ||
    !isReleaseLevel(level) ||
    !Number.isFinite(releaseCms) ||
    releaseCms <= 0
  ) {
    redirect(`${back}?error=form`);
  }

  const supabase = await createClient();
  const [dams, arrivals] = await Promise.all([
    supabase.rpc("dam_map"),
    supabase
      .from("dam_arrivals")
      .select("tambon_code, via, km_from_dam, warn_from_h, earliest_h, latest_h")
      .eq("dam_code", code),
  ]);
  const dam = ((dams.data ?? []) as Record<string, unknown>[]).find((d) => d.code === code);
  if (dams.error || arrivals.error || !dam) redirect(`${back}?error=form`);

  const rows = ((arrivals.data ?? []) as Record<string, unknown>[]).map(
    (r): Pick<DamArrival, "warnFromH" | "latestH"> => ({
      warnFromH: Number(r.warn_from_h ?? 0),
      latestH: Number(r.latest_h ?? 0),
    }),
  ) as DamArrival[];

  const { messages, reason } = await textsFor(
    {
      name: (dam.name ?? {}) as Record<string, string>,
      river: (dam.river ?? {}) as Record<string, string>,
      operator: String(dam.operator ?? ""),
    },
    {
      gatesOpenAt,
      releaseCms,
      expectedEndAt,
      onset: zoneWindow(rows, gatesOpenAt),
    },
  );

  const { error } = await supabase.rpc("admin_send_dam_release", {
    p_dam: code,
    p_gates_open_at: gatesOpenAt.toISOString(),
    p_release_cms: releaseCms,
    p_level: level,
    p_messages: messages,
    p_reason: reason,
    p_next_update_at: nextUpdateAt.toISOString(),
    p_expected_end_at: expectedEndAt ? expectedEndAt.toISOString() : null,
    p_notice: notice === "" ? null : notice,
  });
  if (error) redirect(`${back}?error=send`);
  redirect(`${back}?done=sent`);
}

/** Withdrawing one that went out in error. It leaves every phone at once. */
export async function cancelDamRelease(locale: string, form: FormData) {
  const back = localePath(locale, "/admin/dam-release");
  const alert = String(form.get("alert") ?? "").trim();
  if (alert === "") redirect(`${back}?error=cancel`);
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_cancel_alert", {
    p_alert: alert,
    p_note: "dam release withdrawn from the admin console",
  });
  if (error) redirect(`${back}?error=cancel`);
  redirect(`${back}?done=cancelled`);
}
