import type { SupabaseClient } from "@supabase/supabase-js";
import webpush from "web-push";
import { alertPayload, type PushAlert, type PushLevel } from "@/lib/push";
import en from "@/messages/en.json";
import ms from "@/messages/ms.json";
import th from "@/messages/th.json";

/**
 * Sending web push (A7). Server only: it holds the private key that signs what Jaga sends.
 *
 * It runs as the admin who has just published, with their own session: the database hands the
 * addresses to an admin and to nobody else, and logs that it did. Vercel holds no key that could
 * read them otherwise.
 */
const LEVELS: Record<string, Record<PushLevel, string>> = {
  th: th.alert.level,
  ms: ms.alert.level,
  en: en.alert.level,
};
const levelName = (level: PushLevel, locale: string) => (LEVELS[locale] ?? LEVELS.th!)[level];

export type PushOutcome = { sent: number; failed: number; gone: number } | { skipped: string };

function configured(): boolean {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
  const privateKey = process.env.VAPID_PRIVATE_KEY ?? "";
  const contact = process.env.CONTACT_EMAIL ?? "";
  if (!publicKey || !privateKey || !contact) return false;
  webpush.setVapidDetails(`mailto:${contact}`, publicKey, privateKey);
  return true;
}

type Target = { endpoint: string; keys: { p256dh: string; auth: string }; locale: string };

/**
 * Push one published alert to every phone following a tambon it names. Never throws: an alert is
 * published whether or not a single notification leaves, and the bell and the home screen carry
 * it either way. What happened is written beside the alert for the admins to see.
 */
export async function pushAlert(supabase: SupabaseClient, alertId: string): Promise<PushOutcome> {
  try {
    if (!configured()) return { skipped: "no_keys" };
    const { data: alert } = await supabase
      .from("alerts")
      .select("id, level, messages, is_drill")
      .eq("id", alertId)
      .maybeSingle();
    if (!alert || alert.is_drill) return { skipped: "drill_or_gone" };
    const { data: targets, error } = await supabase.rpc("push_targets_for_alert", {
      p_alert: alertId,
    });
    if (error || !Array.isArray(targets)) return { skipped: "no_targets" };

    const gone: string[] = [];
    let sent = 0;
    let failed = 0;
    const queue = [...(targets as Target[])];
    const worker = async () => {
      for (let t = queue.pop(); t; t = queue.pop()) {
        const payload = alertPayload(alert as PushAlert, t.locale, levelName);
        if (!payload) continue;
        try {
          await webpush.sendNotification(
            { endpoint: t.endpoint, keys: t.keys },
            JSON.stringify(payload),
            // Kept by the push service for a day if the phone is off; a newer alert replaces it.
            { TTL: 24 * 3600, urgency: "high", topic: alertId.replace(/-/g, "").slice(0, 32) },
          );
          sent++;
        } catch (e) {
          const status = (e as { statusCode?: number }).statusCode;
          // 404 and 410: the push service says this address will never work again.
          if (status === 404 || status === 410) gone.push(t.endpoint);
          else failed++;
        }
      }
    };
    await Promise.all(Array.from({ length: 16 }, worker));
    await supabase.rpc("push_record_alert", {
      p_alert: alertId,
      p_sent: sent,
      p_failed: failed,
      p_gone: gone,
    });
    return { sent, failed, gone: gone.length };
  } catch {
    return { skipped: "error" };
  }
}
