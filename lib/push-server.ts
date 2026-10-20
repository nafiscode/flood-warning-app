import { createHmac, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import webpush from "web-push";
import {
  alertPayload,
  announcementPayload,
  casePayload,
  type DueRow,
  type PushAlert,
  type PushLevel,
} from "@/lib/push";
import { siteUrl } from "@/lib/site";
import { createPublicClient } from "@/lib/supabase/public";
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
/** "your area": a notification goes to one phone about its own places, not the whole list. */
const YOUR_AREA: Record<string, string> = {
  th: th.alert.yourArea,
  ms: ms.alert.yourArea,
  en: en.alert.yourArea,
};
const yourArea = (locale: string) => YOUR_AREA[locale] ?? YOUR_AREA.th!;
/** "Drill": said before the level, so a sent drill cannot be read as the real thing. */
const DRILL_TAG: Record<string, string> = {
  th: th.alert.drill.tag,
  ms: ms.alert.drill.tag,
  en: en.alert.drill.tag,
};
const drillTag = (locale: string) => DRILL_TAG[locale] ?? DRILL_TAG.th!;

export type PushOutcome = { sent: number; failed: number; gone: number } | { skipped: string };

function configured(): boolean {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
  const privateKey = process.env.VAPID_PRIVATE_KEY ?? "";
  if (!publicKey || !privateKey) return false;
  // Who a push service may write to about Jaga's messages: the project's address where the
  // server knows it, else the site itself. A missing address must never be what stops an alert
  // from leaving - which it did on 13 Oct, when the live site had the keys but not the address.
  const contact = process.env.CONTACT_EMAIL ?? "";
  const site = siteUrl();
  const subject = contact ? `mailto:${contact}` : site.startsWith("https://") ? site : null;
  if (!subject) return false;
  webpush.setVapidDetails(subject, publicKey, privateKey);
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
      .select("id, level, messages, is_drill, drill_audience")
      .eq("id", alertId)
      .maybeSingle();
    // A drill is pushed only when an audience was ticked for it; the database narrows the
    // addresses to that audience, and refuses the silent drill all over again.
    const audience = (alert?.drill_audience ?? []) as string[];
    const drill = alert?.is_drill === true;
    if (!alert || (drill && audience.length === 0)) return { skipped: "drill_or_gone" };
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
        const payload = alertPayload(
          { ...(alert as PushAlert), drill },
          t.locale,
          levelName,
          yourArea(t.locale),
          drillTag(t.locale),
        );
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

const ANNOUNCE_TITLE: Record<string, string> = {
  th: th.push.send.announcementTitle,
  ms: ms.push.send.announcementTitle,
  en: en.push.send.announcementTitle,
};

/**
 * Push one announcement the admin has just posted, to the phones it is for. Like an alert's, it
 * runs with the admin's own session and never throws: the announcement is in the bell whether or
 * not a notification leaves.
 */
export async function pushAnnouncement(
  supabase: SupabaseClient,
  id: string,
  messages: Record<string, string>,
): Promise<PushOutcome> {
  try {
    if (!configured()) return { skipped: "no_keys" };
    const { data, error } = await supabase.rpc("push_targets_for_announcement", {
      p_announcement: id,
    });
    if (error || !Array.isArray(data)) return { skipped: "no_targets" };
    const gone: string[] = [];
    let sent = 0;
    let failed = 0;
    const queue = [...(data as Target[])];
    const worker = async () => {
      for (let t = queue.pop(); t; t = queue.pop()) {
        const payload = announcementPayload(
          { id, messages },
          t.locale,
          ANNOUNCE_TITLE[t.locale] ?? ANNOUNCE_TITLE.th!,
        );
        if (!payload) continue;
        try {
          await webpush.sendNotification(
            { endpoint: t.endpoint, keys: t.keys },
            JSON.stringify(payload),
            { TTL: 24 * 3600, urgency: "normal" },
          );
          sent++;
        } catch (e) {
          const status = (e as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) gone.push(t.endpoint);
          else failed++;
        }
      }
    };
    await Promise.all(Array.from({ length: 16 }, worker));
    if (gone.length > 0) await supabase.rpc("push_drop_gone", { p_gone: gone });
    return { sent, failed, gone: gone.length };
  } catch {
    return { skipped: "error" };
  }
}

const GATE_LABEL = "jaga-push-gate-v1";

/**
 * The token Jaga's server proves itself with when it asks the database what is owed (and that
 * the database's one-minute tick sends back). Derived from the signing key the server already
 * holds, so there is no second secret to keep: whoever can sign Jaga's pushes may ask whom to
 * push to, and nobody else. `scripts/push-gate.mjs` stores the same value in the database.
 */
export function gateToken(): string | null {
  const privateKey = process.env.VAPID_PRIVATE_KEY ?? "";
  if (!privateKey) return null;
  return createHmac("sha256", privateKey).update(GATE_LABEL).digest("hex");
}

/** Whether a caller of the tick route holds the token, compared without leaking where it differs. */
export function gateOpens(given: string | null): boolean {
  const token = gateToken();
  if (!token || !given || given.length !== token.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(token));
}

const SEND_WORDS: Record<string, Record<string, string>> = {
  th: th.push.send,
  ms: ms.push.send,
  en: en.push.send,
};

type Due = DueRow & { endpoint: string; keys: { p256dh: string; auth: string } };

/**
 * Ask the database what notifications about requests for help are owed right now, and send
 * them: the offer to the team being asked, "nobody has accepted" to the admins, each step to the
 * sender. Called whenever something happens to a case and once a minute by the database, which
 * is what moves an offer to the next team's phone while nobody has the app open.
 *
 * Never throws and never matters to the request it rides on: a case is on every covering team's
 * board whether or not a single notification leaves (safety rule 1).
 */
/** When this server instance last started a tick: many requests in a burst share one. */
let lastTickAt = 0;
const TICK_GAP_MS = 3_000;

export async function runPushTick(): Promise<PushOutcome> {
  // A burst of requests (a poll every 20 s from every open case, a cron, an action) would
  // otherwise each run the whole tick; one every few seconds hands out everything that is due.
  const now = Date.now();
  if (now - lastTickAt < TICK_GAP_MS) return { skipped: "recent" };
  lastTickAt = now;
  try {
    const token = gateToken();
    // The LINE half runs beside this one, whatever happens to web push.
    const line = import("@/lib/line-server").then((m) => m.lineCaseTick()).catch(() => null);
    if (!token || !configured()) {
      await line;
      return { skipped: "no_keys" };
    }
    const supabase = createPublicClient();
    const { data, error } = await supabase.rpc("push_due", { p_token: token });
    if (error || !Array.isArray(data)) return { skipped: "not_set_up" };
    const gone: string[] = [];
    let sent = 0;
    let failed = 0;
    const queue = [...(data as Due[])];
    const worker = async () => {
      for (let row = queue.pop(); row; row = queue.pop()) {
        const payload = casePayload(row, SEND_WORDS[row.locale] ?? SEND_WORDS.th!);
        if (!payload) continue;
        try {
          await webpush.sendNotification(
            { endpoint: row.endpoint, keys: row.keys },
            JSON.stringify(payload),
            // An offer is worth nothing once its window and the next few have passed.
            { TTL: payload.kind === "offer" ? 600 : 6 * 3600, urgency: "high" },
          );
          sent++;
        } catch (e) {
          const status = (e as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) gone.push(row.endpoint);
          else failed++;
        }
      }
    };
    await Promise.all(Array.from({ length: 8 }, worker));
    const auto = await autoAlarmTick(supabase, token, gone);
    if (gone.length > 0) await supabase.rpc("push_forget", { p_token: token, p_endpoints: gone });
    await line;
    return { sent: sent + auto.sent, failed: failed + auto.failed, gone: gone.length };
  } catch {
    return { skipped: "error" };
  }
}

const AUTO_WORDS: Record<string, { title: string; body: string }> = {
  th: th.signals.push,
  ms: ms.signals.push,
  en: en.signals.push,
};

/**
 * The automated alarm's pushes (the owner's decision of 14 Oct 2026): to every admin, a gauge set
 * to automatic has crossed its threshold and a draft is waiting, with the time it will be sent by
 * itself; and, once a draft has been published because nobody acted, the alert to the phones that
 * follow its tambons. The database decides what is owed and hands each out once.
 */
async function autoAlarmTick(
  supabase: ReturnType<typeof createPublicClient>,
  token: string,
  gone: string[],
): Promise<{ sent: number; failed: number }> {
  const { data, error } = await supabase.rpc("auto_alarm_push_due", { p_token: token });
  if (error || !Array.isArray(data)) return { sent: 0, failed: 0 };
  let sent = 0;
  let failed = 0;
  for (const row of data as {
    kind: string;
    endpoint: string;
    keys: { p256dh: string; auth: string };
    locale: string;
    data: Record<string, unknown>;
  }[]) {
    let payload: unknown = null;
    if (row.kind === "auto_alarm") {
      const words = AUTO_WORDS[row.locale] ?? AUTO_WORDS.th!;
      const d = row.data;
      const zone =
        ((d.zone ?? {}) as Record<string, string>)[row.locale] ??
        (d.zone as Record<string, string>)?.th ??
        "";
      const level = levelName(d.level as PushLevel, row.locale);
      const deadline = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Bangkok",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(String(d.deadline)));
      const fill = (text: string) =>
        text
          .replace("{level}", level)
          .replace("{zone}", zone)
          .replace("{gauge}", String(d.gauge ?? ""))
          .replace("{value}", String(d.value ?? ""))
          .replace("{time}", deadline);
      payload = {
        kind: "auto_alarm",
        title: fill(words.title),
        body: fill(words.body),
        url: row.locale === "th" ? "/admin/signals" : `/${row.locale}/admin/signals`,
        tag: `auto-${String(d.event)}`,
        sticky: true,
      };
    } else if (row.kind === "alert") {
      payload = alertPayload(
        row.data as unknown as PushAlert,
        row.locale,
        levelName,
        yourArea(row.locale),
      );
    }
    if (!payload) continue;
    try {
      await webpush.sendNotification(
        { endpoint: row.endpoint, keys: row.keys },
        JSON.stringify(payload),
        {
          TTL: 6 * 3600,
          urgency: "high",
        },
      );
      sent++;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) gone.push(row.endpoint);
      else failed++;
    }
  }
  return { sent, failed };
}

const FIELD_WORDS: Record<string, { title: string; body: string }> = {
  th: th.adminTools.field.push,
  ms: ms.adminTools.field.push,
  en: en.adminTools.field.push,
};

/**
 * Tell the admins' phones that a rescue a team found by itself is waiting for them (the owner,
 * 14 Oct). Asked with the server's own token, like the per-minute tick: a team's session is never
 * handed the admins' push addresses. The database hands them out once per record. It names the
 * team and the tambon, never the place or the person. Never throws: the record is on the
 * admins' Waiting list whether or not a notification leaves.
 */
export async function pushFieldHeld(rescueId: string): Promise<PushOutcome> {
  try {
    const token = gateToken();
    if (!token || !configured()) return { skipped: "no_keys" };
    const supabase = createPublicClient();
    const { data, error } = await supabase.rpc("push_field_held", {
      p_token: token,
      p_rescue: rescueId,
    });
    if (error || !Array.isArray(data)) return { skipped: "not_set_up" };
    type Row = Target & { unit_name: string; tambon_th: string; tambon_en: string };
    const gone: string[] = [];
    let sent = 0;
    let failed = 0;
    for (const row of data as Row[]) {
      const words = FIELD_WORDS[row.locale] ?? FIELD_WORDS.th!;
      const place = row.locale === "th" || !row.tambon_en ? row.tambon_th : row.tambon_en;
      const payload = {
        // The service worker's plain kind: a title, words, and a page of this app to open.
        kind: "announcement",
        title: words.title,
        body: words.body.replace("{unit}", row.unit_name).replace("{place}", place),
        url: `${row.locale === "th" ? "" : `/${row.locale}`}/admin/field-rescues`,
        tag: `field-${rescueId}`,
        sticky: false,
      };
      try {
        await webpush.sendNotification(
          { endpoint: row.endpoint, keys: row.keys },
          JSON.stringify(payload),
          { TTL: 24 * 3600, urgency: "normal" },
        );
        sent++;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) gone.push(row.endpoint);
        else failed++;
      }
    }
    if (gone.length > 0) await supabase.rpc("push_forget", { p_token: token, p_endpoints: gone });
    return { sent, failed, gone: gone.length };
  } catch {
    return { skipped: "error" };
  }
}
