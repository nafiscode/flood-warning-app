"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";
import { createTranslator } from "next-intl";
import { routing } from "@/i18n/routing";
import { localePath } from "@/lib/auth";
import type { DamArrival } from "@/lib/dam-arrival";
import {
  bangkokInput,
  isReleaseLevel,
  releaseEndReason,
  releaseEndText,
  releaseReason,
  releaseText,
  zoneWindow,
  type ReleaseEndInput,
  type ReleaseInput,
} from "@/lib/dam-release";
import { localName } from "@/lib/places";
import { pushDamReleaseAdmins } from "@/lib/push-server";
import { createClient } from "@/lib/supabase/server";
import { BANGKOK_DATE_TIME } from "@/lib/time";

/**
 * The dam operator's three acts (docs/spec.md section 15, A12 part 2).
 *
 * Deliberately thin. Each of these does two things: build the reviewed template in all three
 * languages, and hand the figures to a database function that checks for itself that the caller
 * holds this dam through a verified link an admin made. Nothing here decides who may send - if
 * this file were wrong in every line, an operator still could not send for a dam that is not
 * theirs, because `operator_send_dam_release` asks the database and not the page.
 *
 * The one judgement that is a person's, and stays a person's, is whether to send at all and at
 * what level (safety rule 2).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type DamFacts = { name: Record<string, string>; river: Record<string, string>; operator: string };

/** The dam's names, read as the caller: `dams` is public, so this needs no special path. */
async function damFacts(
  supabase: Awaited<ReturnType<typeof createClient>>,
  code: string,
): Promise<DamFacts | null> {
  const { data, error } = await supabase.rpc("dam_map");
  if (error) return null;
  const row = ((data ?? []) as Record<string, unknown>[]).find((d) => d.code === code);
  if (!row) return null;
  return {
    name: (row.name ?? {}) as Record<string, string>,
    river: (row.river ?? {}) as Record<string, string>,
    operator: String(row.operator ?? ""),
  };
}

async function arrivalsFor(
  supabase: Awaited<ReturnType<typeof createClient>>,
  code: string,
): Promise<DamArrival[]> {
  const { data } = await supabase
    .from("dam_arrivals")
    .select("warn_from_h, latest_h")
    .eq("dam_code", code);
  return ((data ?? []) as Record<string, unknown>[]).map(
    (r) =>
      ({
        warnFromH: Number(r.warn_from_h ?? 0),
        latestH: Number(r.latest_h ?? 0),
      }) as DamArrival,
  );
}

/** The three languages of a notice, from the one reviewed template. Thai decides the reason line. */
async function textsFor(
  dam: DamFacts,
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
    if (locale === routing.defaultLocale) reason = releaseReason(say, time, input);
  }
  return { messages, reason };
}

/** The same for "the gates have closed", which keeps the level it replaces. */
async function endTextsFor(
  dam: DamFacts,
  figures: Omit<ReleaseEndInput, "damName" | "river" | "operator">,
): Promise<{ messages: Record<string, string>; reason: string }> {
  const messages: Record<string, string> = {};
  let reason = "";
  for (const locale of routing.locales) {
    const loaded = (await import(`../../../../messages/${locale}.json`)).default;
    const say = createTranslator({ locale, messages: loaded, namespace: "dam" });
    const time = (at: Date) =>
      new Intl.DateTimeFormat(locale, BANGKOK_DATE_TIME).format(at).replace(/‏/g, "");
    const input: ReleaseEndInput = {
      ...figures,
      damName: localName(dam.name, locale),
      river: localName(dam.river, locale),
      operator: dam.operator,
    };
    messages[locale] = releaseEndText(say, time, input);
    if (locale === routing.defaultLocale) reason = releaseEndReason(say, time, input);
  }
  return { messages, reason };
}

export async function sendRelease(locale: string, form: FormData) {
  const back = localePath(locale, "/authority/dam");
  const code = String(form.get("dam") ?? "").trim();
  const gatesOpenAt = bangkokInput(String(form.get("gatesOpenAt") ?? ""));
  const expectedEndAt = bangkokInput(String(form.get("expectedEnd") ?? ""));
  const nextUpdateAt = bangkokInput(String(form.get("nextUpdate") ?? ""));
  const level = String(form.get("level") ?? "");
  const releaseCms = Number.parseFloat(String(form.get("releaseCms") ?? ""));
  const drill = String(form.get("drill") ?? "") === "yes";

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
  const [dam, arrivals] = await Promise.all([damFacts(supabase, code), arrivalsFor(supabase, code)]);
  if (!dam) redirect(`${back}?error=form`);

  const { messages, reason } = await textsFor(dam, {
    gatesOpenAt,
    releaseCms,
    expectedEndAt,
    onset: zoneWindow(arrivals, gatesOpenAt),
    // The last line of the notice names the dam, not a Jaga admin (safety rule 3).
    byOperator: true,
  });

  const { data, error } = await supabase.rpc("operator_send_dam_release", {
    p_dam: code,
    p_gates_open_at: gatesOpenAt.toISOString(),
    p_release_cms: releaseCms,
    p_level: level,
    p_messages: messages,
    p_reason: reason,
    p_next_update_at: nextUpdateAt.toISOString(),
    p_expected_end_at: expectedEndAt ? expectedEndAt.toISOString() : null,
    p_drill: drill,
  });
  if (error) redirect(`${back}?error=send`);

  // Spec 15: the admins are told at the same moment. The bell already lists it the next time one
  // of them looks; this is the half that reaches a phone in a pocket. It never throws and never
  // holds up the redirect: a notification that fails must not make the operator think the notice
  // did too.
  if (typeof data === "string") after(() => pushDamReleaseAdmins(data));
  redirect(`${back}?done=${drill ? "sentDrill" : "sent"}`);
}

/** "The gates have closed." It keeps the level: only an admin stands a level down. */
export async function endRelease(locale: string, form: FormData) {
  const back = localePath(locale, "/authority/dam");
  const alert = String(form.get("alert") ?? "").trim();
  const code = String(form.get("dam") ?? "").trim();
  const closedAt = bangkokInput(String(form.get("closedAt") ?? ""));
  const nextUpdateAt = bangkokInput(String(form.get("nextUpdate") ?? ""));
  if (!UUID.test(alert) || code === "" || !closedAt || !nextUpdateAt) {
    redirect(`${back}?error=end`);
  }

  const supabase = await createClient();
  const [dam, arrivals] = await Promise.all([damFacts(supabase, code), arrivalsFor(supabase, code)]);
  if (!dam) redirect(`${back}?error=end`);

  const { messages, reason } = await endTextsFor(dam, {
    gatesClosedAt: closedAt,
    // The window of the notice being replaced is the same water, so it is counted the same way.
    onset: zoneWindow(arrivals, closedAt),
  });

  const { data, error } = await supabase.rpc("operator_end_dam_release", {
    p_alert: alert,
    p_closed_at: closedAt.toISOString(),
    p_messages: messages,
    p_reason: reason,
    p_next_update_at: nextUpdateAt.toISOString(),
  });
  if (error) redirect(`${back}?error=end`);
  if (typeof data === "string") after(() => pushDamReleaseAdmins(data));
  redirect(`${back}?done=ended`);
}

/** Withdrawing one it sent itself. It leaves every phone at once. */
export async function withdrawRelease(locale: string, form: FormData) {
  const back = localePath(locale, "/authority/dam");
  const alert = String(form.get("alert") ?? "").trim();
  if (!UUID.test(alert)) redirect(`${back}?error=withdraw`);
  const supabase = await createClient();
  const { error } = await supabase.rpc("operator_cancel_dam_release", {
    p_alert: alert,
    p_note: "withdrawn by the dam's operator",
  });
  if (error) redirect(`${back}?error=withdraw`);
  redirect(`${back}?done=withdrawn`);
}
