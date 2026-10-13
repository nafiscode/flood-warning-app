import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { alertFlex, batches, statusText, type LineStatus, type LineWords } from "@/lib/line";
import { gateToken } from "@/lib/push-server";
import { siteUrl } from "@/lib/site";
import { createPublicClient } from "@/lib/supabase/public";
import en from "@/messages/en.json";
import ms from "@/messages/ms.json";
import th from "@/messages/th.json";

/**
 * LINE Messaging API (A7). Server only: the channel's token can message every follower, so it
 * lives in the server's environment and nowhere else.
 */
const API = "https://api.line.me/v2/bot";
const ALL = { th, ms, en } as const;
type Locale = keyof typeof ALL;
const localeOf = (value: string): Locale => (value === "ms" || value === "en" ? value : "th");
const wordsOf = (locale: Locale): LineWords => ALL[locale].line;
const levelOf = (locale: Locale, level: string) =>
  (ALL[locale].alert.level as Record<string, string>)[level] ?? level;

const accessToken = () => (process.env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN ?? "").trim();
const channelSecret = () => (process.env.LINE_MESSAGING_CHANNEL_SECRET ?? "").trim();

export type LineOutcome =
  { recipients: number; failed: number; warnAt: number | null } | { skipped: string };

async function call(
  path: string,
  init: { method?: string; body?: unknown; retryKey?: string } = {},
): Promise<{ ok: boolean; status: number; json: Record<string, unknown> | null }> {
  const response = await fetch(`${API}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${accessToken()}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.retryKey ? { "X-Line-Retry-Key": init.retryKey } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  let json: Record<string, unknown> | null = null;
  try {
    json = (await response.json()) as Record<string, unknown>;
  } catch {
    // An empty answer is fine.
  }
  return { ok: response.ok, status: response.status, json };
}

/**
 * One group of people, one message, tried up to three times with the same retry key, so a
 * second try can never deliver twice. A refusal LINE means (a bad message, the month's quota
 * spent) is not tried again.
 */
async function multicast(to: string[], message: Record<string, unknown>): Promise<boolean> {
  const retryKey = randomUUID();
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await call("/message/multicast", {
        method: "POST",
        body: { to, messages: [message] },
        retryKey,
      });
      // 409: LINE already accepted this very request on an earlier try.
      if (r.ok || r.status === 409) return true;
      if (r.status < 500) return false;
    } catch {
      // A timeout or a dropped connection: try again.
    }
    await new Promise((done) => setTimeout(done, 500 * 2 ** attempt));
  }
  return false;
}

/** What LINE itself counts for the month: the plan's limit and what has been used. */
async function quota(): Promise<{ used: number | null; limit: number | null }> {
  try {
    const [plan, used] = await Promise.all([
      call("/message/quota"),
      call("/message/quota/consumption"),
    ]);
    return {
      used: typeof used.json?.totalUsage === "number" ? used.json.totalUsage : null,
      // An unlimited plan has no figure; nothing to warn about then.
      limit:
        plan.json?.type === "limited" && typeof plan.json.value === "number"
          ? plan.json.value
          : null,
    };
  } catch {
    return { used: null, limit: null };
  }
}

/**
 * Send one published alert through LINE to the people it concerns, in their own language, one
 * message each (spec 4.8). Runs as the admin who has just published. Never throws: the alert is
 * in the app, on the map and in the bell whether or not LINE takes it, and what happened is
 * written beside the alert for the admins.
 */
export async function lineAlert(supabase: SupabaseClient, alertId: string): Promise<LineOutcome> {
  try {
    if (!accessToken()) return { skipped: "no_token" };
    const { data: alert } = await supabase
      .from("alerts")
      .select("id, level, messages, next_update_at, is_drill")
      .eq("id", alertId)
      .maybeSingle();
    if (!alert || alert.is_drill) return { skipped: "drill_or_gone" };
    const { data: targets, error } = await supabase.rpc("line_targets_for_alert", {
      p_alert: alertId,
    });
    if (error || !Array.isArray(targets)) return { skipped: "no_targets" };
    if (targets.length === 0) return { recipients: 0, failed: 0, warnAt: null };

    const byLocale = new Map<Locale, string[]>();
    for (const t of targets as { line_user_id: string; locale: string }[]) {
      const locale = localeOf(t.locale);
      byLocale.set(locale, [...(byLocale.get(locale) ?? []), t.line_user_id]);
    }
    let recipients = 0;
    let failed = 0;
    for (const [locale, ids] of byLocale) {
      const message = alertFlex(
        {
          id: alert.id as string,
          level: alert.level as string,
          messages: alert.messages as Record<string, string>,
          nextUpdateAt: alert.next_update_at as string | null,
        },
        locale,
        levelOf(locale, alert.level as string),
        wordsOf(locale),
        siteUrl(),
      );
      if (!message) continue;
      for (const group of batches(ids)) {
        if (await multicast(group, message)) recipients += group.length;
        else failed += group.length;
      }
    }
    const q = await quota();
    const { data: mark } = await supabase.rpc("line_record_alert", {
      p_alert: alertId,
      p_recipients: recipients,
      p_failed: failed,
      p_used: q.used,
      p_limit: q.limit,
    });
    return { recipients, failed, warnAt: typeof mark === "number" ? mark : null };
  } catch {
    return { skipped: "error" };
  }
}

/** Whether a webhook body really came from LINE: its signature, made with the channel secret. */
export function lineSignatureOk(body: string, signature: string | null): boolean {
  const secret = channelSecret();
  if (!secret || !signature) return false;
  const expected = createHmac("sha256", secret).update(body).digest("base64");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

type LineEvent = {
  type?: string;
  replyToken?: string;
  source?: { type?: string; userId?: string };
};

/**
 * What LINE tells Jaga (A7): someone added or blocked the account, or wrote to it. A follow or
 * a block is remembered, so an alert is not spent on someone who cannot receive it. Anything
 * written to the account is answered with that person's own area status, through the Reply API,
 * which costs nothing.
 */
export async function handleLineEvents(events: LineEvent[]): Promise<void> {
  const token = gateToken();
  if (!token) return;
  const supabase = createPublicClient();
  for (const event of events.slice(0, 50)) {
    const user = event.source?.type === "user" ? event.source.userId : null;
    if (!user) continue;
    try {
      if (event.type === "follow" || event.type === "unfollow") {
        await supabase.rpc("line_follow_event", {
          p_token: token,
          p_line_user: user,
          p_following: event.type === "follow",
        });
      }
      if ((event.type === "message" || event.type === "postback") && event.replyToken) {
        const { data } = await supabase.rpc("line_status_for", {
          p_token: token,
          p_line_user: user,
        });
        const row = (Array.isArray(data) ? data[0] : data) as
          | { locale: string; known: boolean; has_places: boolean; alerts: LineStatus["alerts"] }
          | undefined;
        if (!row) continue;
        const locale = localeOf(row.locale);
        const text = statusText(
          { known: row.known, hasPlaces: row.has_places, alerts: row.alerts ?? [] },
          locale,
          (level) => levelOf(locale, level),
          wordsOf(locale),
        );
        await call("/message/reply", {
          method: "POST",
          body: { replyToken: event.replyToken, messages: [{ type: "text", text }] },
        });
      }
    } catch {
      // One bad event must not stop the rest; LINE does not resend what was acknowledged.
    }
  }
}
