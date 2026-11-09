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

/** Whether this server holds the keys to send at all; also sets them on web-push. Shared with
 * the severe-weather run (lib/weather-advisory-server.ts). */
export function configured(): boolean {
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

/**
 * The three sets of words the alarm's push to the admins can carry: a gauge over its bank, a
 * reservoir near full, and the all-clear. A gauge reads in metres and a reservoir as a share of
 * its capacity, and the all-clear is not a warning at all, so one body cannot serve all three
 * (27 Oct 2026).
 */
const AUTO_WORDS: Record<string, Record<string, { title: string; body: string }>> = {
  th: { gauge: th.signals.push, reservoir: th.signals.pushReservoir, clear: th.signals.pushClear },
  ms: { gauge: ms.signals.push, reservoir: ms.signals.pushReservoir, clear: ms.signals.pushClear },
  en: { gauge: en.signals.push, reservoir: en.signals.pushReservoir, clear: en.signals.pushClear },
};

/**
 * The same three, for an alert the alarm has already published (the owner, 9 Nov 2026). They say
 * what has gone out and offer the way to check, change or cancel it - never a deadline, because
 * nothing is waiting any more.
 */
const AUTO_SENT_WORDS: Record<string, Record<string, { title: string; body: string }>> = {
  th: {
    gauge: th.signals.pushSent,
    reservoir: th.signals.pushSentReservoir,
    clear: th.signals.pushSentClear,
  },
  ms: {
    gauge: ms.signals.pushSent,
    reservoir: ms.signals.pushSentReservoir,
    clear: ms.signals.pushSentClear,
  },
  en: {
    gauge: en.signals.pushSent,
    reservoir: en.signals.pushSentReservoir,
    clear: en.signals.pushSentClear,
  },
};

/** Why a draft is waiting rather than already sent: its reading could not be believed. */
const AUTO_HELD: Record<string, string> = {
  th: th.signals.pushHeld,
  ms: ms.signals.pushHeld,
  en: en.signals.pushHeld,
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
      const d = row.data;
      const which = d.clear === true ? "clear" : d.dam ? "reservoir" : "gauge";
      const set = AUTO_WORDS[row.locale] ?? AUTO_WORDS.th!;
      const words = set[which] ?? set.gauge!;
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
          .replace("{percent}", String(d.percent ?? ""))
          .replace("{value}", String(d.value ?? ""))
          .replace("{time}", deadline);
      payload = {
        kind: "auto_alarm",
        title: fill(words.title),
        // A draft only waits when its reading looked wrong, so the admin is told that much here
        // rather than having to open the console to find out (9 Nov 2026).
        body: d.held
          ? `${fill(words.body)} ${AUTO_HELD[row.locale] ?? AUTO_HELD.th!}`
          : fill(words.body),
        url: row.locale === "th" ? "/admin/signals" : `/${row.locale}/admin/signals`,
        tag: `auto-${String(d.event)}`,
        sticky: true,
      };
    } else if (row.kind === "auto_alarm_sent") {
      // The alarm has already published. Every admin is told, and the phone shakes with the
      // level's own pattern (app/sw.ts), because an alert is in force by now.
      const d = row.data;
      const which = d.clear === true ? "clear" : d.dam ? "reservoir" : "gauge";
      const set = AUTO_SENT_WORDS[row.locale] ?? AUTO_SENT_WORDS.th!;
      const words = set[which] ?? set.gauge!;
      const zone =
        ((d.zone ?? {}) as Record<string, string>)[row.locale] ??
        (d.zone as Record<string, string>)?.th ??
        "";
      const level = levelName(d.level as PushLevel, row.locale);
      const fill = (text: string) =>
        text
          .replace("{level}", level)
          .replace("{zone}", zone)
          .replace("{gauge}", String(d.gauge ?? ""))
          .replace("{percent}", String(d.percent ?? ""))
          .replace("{value}", String(d.value ?? ""));
      payload = {
        kind: "auto_alarm_sent",
        title: fill(words.title),
        body: fill(words.body),
        url: row.locale === "th" ? "/admin/alerts" : `/${row.locale}/admin/alerts`,
        tag: `auto-sent-${String(d.event)}`,
        sticky: true,
        // 'return' is a level of its own for the alert sounds; the type covers it.
        level: d.level as PushLevel,
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
    // All the admins' phones at once, and at high priority like the registration push (owner,
    // 24 Oct): an idle Android phone holds a normal one back. Speed only, never a ring.
    await Promise.all(
      (data as Row[]).map(async (row) => {
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
            { TTL: 24 * 3600, urgency: "high" },
          );
          sent++;
        } catch (e) {
          const status = (e as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) gone.push(row.endpoint);
          else failed++;
        }
      }),
    );
    if (gone.length > 0) await supabase.rpc("push_forget", { p_token: token, p_endpoints: gone });
    return { sent, failed, gone: gone.length };
  } catch {
    return { skipped: "error" };
  }
}

const UNIT_WORDS: Record<string, { title: string; body: string }> = {
  th: th.adminTools.unitWaiting.push,
  ms: ms.adminTools.unitWaiting.push,
  en: en.adminTools.unitWaiting.push,
};

/**
 * Tell the admins' phones that a team has registered and is waiting to be verified (the owner,
 * 24 Oct). The same shape as the held field rescue above: asked with the server's own token, the
 * database hands the admins' addresses out once per unit, it names the team and nothing else, and
 * it never throws - the team is in the admins' bell whether or not a notification leaves.
 */
export async function pushUnitWaiting(unitId: string): Promise<PushOutcome> {
  try {
    const token = gateToken();
    if (!token || !configured()) return { skipped: "no_keys" };
    const supabase = createPublicClient();
    const { data, error } = await supabase.rpc("push_unit_waiting", {
      p_token: token,
      p_unit: unitId,
    });
    if (error || !Array.isArray(data)) return { skipped: "not_set_up" };
    type Row = Target & { unit_name: string };
    const gone: string[] = [];
    let sent = 0;
    let failed = 0;
    // All the admins' phones at once, and at high priority: an Android phone that is idle holds a
    // normal one back until it next wakes, which is how the first version arrived "a little late"
    // (the owner, 24 Oct). The sound is still the phone's ordinary one; priority is only speed.
    await Promise.all(
      (data as Row[]).map(async (row) => {
        const words = UNIT_WORDS[row.locale] ?? UNIT_WORDS.th!;
        const payload = {
          // The service worker's plain kind: a title, words, and a page of this app to open.
          kind: "announcement",
          title: words.title,
          body: words.body.replace("{unit}", row.unit_name),
          url: `${row.locale === "th" ? "" : `/${row.locale}`}/admin/authorities`,
          tag: `unit-${unitId}`,
          sticky: false,
        };
        try {
          await webpush.sendNotification(
            { endpoint: row.endpoint, keys: row.keys },
            JSON.stringify(payload),
            { TTL: 24 * 3600, urgency: "high" },
          );
          sent++;
        } catch (e) {
          const status = (e as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) gone.push(row.endpoint);
          else failed++;
        }
      }),
    );
    if (gone.length > 0) await supabase.rpc("push_forget", { p_token: token, p_endpoints: gone });
    return { sent, failed, gone: gone.length };
  } catch {
    return { skipped: "error" };
  }
}

const DAM_RELEASE_WORDS: Record<
  string,
  { title: string; body: string; ended: string; drill: string }
> = {
  th: th.adminTools.damRelease.push,
  ms: ms.adminTools.damRelease.push,
  en: en.adminTools.damRelease.push,
};

/**
 * Tell the admins' phones that a dam's own operator has sent a release notice (A12 part 2,
 * spec 15: "Admins. Told at the same moment").
 *
 * This one is different from the queues in the bell, which deliberately make no sound: this has
 * already gone out to the public, by the owner's design of 9 Nov, and the admins are the people
 * who can extend, supersede or cancel it. So it reaches a phone in a pocket, at high priority,
 * once per notice - the database hands the addresses out once (dam_release_admin_push) and only
 * for a notice the operator sent, never for an admin's own.
 *
 * A drill is pushed too, with words that say it was one: a drill nobody is told about proves
 * nothing about this road, which is the whole reason the drill switch exists.
 *
 * It never throws. The notice is published whatever happens here, and it is in the bell.
 */
export async function pushDamReleaseAdmins(alertId: string): Promise<PushOutcome> {
  try {
    const token = gateToken();
    if (!token || !configured()) return { skipped: "no_keys" };
    const supabase = createPublicClient();
    const { data, error } = await supabase.rpc("push_dam_release_admins", {
      p_token: token,
      p_alert: alertId,
    });
    if (error || !Array.isArray(data)) return { skipped: "not_set_up" };
    type Row = Target & {
      dam_name: Record<string, string> | null;
      level: string;
      unit_name: string | null;
      drill: boolean;
      ended: boolean;
    };
    const gone: string[] = [];
    let sent = 0;
    let failed = 0;
    await Promise.all(
      (data as Row[]).map(async (row) => {
        const words = DAM_RELEASE_WORDS[row.locale] ?? DAM_RELEASE_WORDS.th!;
        const dam = row.dam_name?.[row.locale] ?? row.dam_name?.th ?? "";
        const unit = row.unit_name ?? "";
        const level = levelName(row.level as PushLevel, row.locale);
        const body = (row.drill ? words.drill : row.ended ? words.ended : words.body)
          .replace("{unit}", unit)
          .replace("{dam}", dam)
          .replace("{level}", level);
        const payload = {
          kind: "announcement",
          title: words.title,
          body,
          url: `${row.locale === "th" ? "" : `/${row.locale}`}/admin/alerts`,
          tag: `dam-release-${alertId}`,
          sticky: false,
        };
        try {
          await webpush.sendNotification(
            { endpoint: row.endpoint, keys: row.keys },
            JSON.stringify(payload),
            { TTL: 6 * 3600, urgency: "high" },
          );
          sent++;
        } catch (e) {
          const status = (e as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) gone.push(row.endpoint);
          else failed++;
        }
      }),
    );
    if (gone.length > 0) await supabase.rpc("push_forget", { p_token: token, p_endpoints: gone });
    return { sent, failed, gone: gone.length };
  } catch {
    return { skipped: "error" };
  }
}
