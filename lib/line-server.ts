import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  adminWelcomeMessage,
  alertFlex,
  answerSticker,
  answerText,
  batches,
  caseLineMessage,
  decisionLineMessage,
  greetingSticker,
  readPress,
  statusSticker,
  stickerMessage,
  type DecisionRow,
  type DecisionWords,
  statusText,
  type LineStatus,
  type LineWords,
} from "@/lib/line";
import type { DueRow } from "@/lib/push";
import { gateToken, runPushTick } from "@/lib/push-server";
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
/** "Drill · Warning": a sent drill says what it is before it says the level. */
const headOf = (locale: Locale, level: string, drill: boolean) =>
  drill ? `${ALL[locale].alert.drill.tag} · ${levelOf(locale, level)}` : levelOf(locale, level);

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
      .select("id, level, messages, next_update_at, is_drill, template_id, drill_audience")
      .eq("id", alertId)
      .maybeSingle();
    // Only a drill with an audience goes out; the database narrows the ids to that audience.
    const drill = alert?.is_drill === true;
    const audience = (alert?.drill_audience ?? []) as string[];
    if (!alert || (drill && audience.length === 0)) return { skipped: "drill_or_gone" };
    const { data: targets, error } = await supabase.rpc("line_targets_for_alert", {
      p_alert: alertId,
    });
    if (error || !Array.isArray(targets)) return { skipped: "no_targets" };
    if (targets.length === 0) return { recipients: 0, failed: 0, warnAt: null };

    // The reviewed template and the size of the area, so each person reads "your area" rather
    // than a list of other people's tambons. Either may be missing; the stored words then stand.
    const [{ data: template }, { count: tambons }] = await Promise.all([
      alert.template_id
        ? supabase
            .from("alert_templates")
            .select("messages")
            .eq("id", alert.template_id as string)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      supabase
        .from("alert_tambons")
        .select("tambon", { count: "exact", head: true })
        .eq("alert_id", alertId),
    ]);

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
          /*
           * A sent drill keeps its own stored words. The reviewed template is the real thing's
           * instructions, and personalising them here would put "move to higher ground" into
           * the body of a drill.
           */
          template: drill
            ? null
            : ((template?.messages as Record<string, string> | undefined) ?? null),
          tambons: tambons ?? 0,
        },
        locale,
        headOf(locale, alert.level as string, drill),
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

/**
 * Whether LINE accepts this server's access token: "ok", "none" when there is no token here, or
 * the status LINE refused it with (401 for a wrong or cut-short token). Says nothing else.
 */
export async function lineTokenState(): Promise<"ok" | "none" | number> {
  if (!accessToken()) return "none";
  try {
    const r = await call("/info");
    return r.ok ? "ok" : r.status;
  } catch {
    return 0;
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
  postback?: { data?: string };
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
        // A new friend is greeted by Ja or Ga; a reply costs nothing from the month's quota.
        if (event.type === "follow" && event.replyToken) {
          await call("/message/reply", {
            method: "POST",
            body: {
              replyToken: event.replyToken,
              messages: [stickerMessage(siteUrl(), greetingSticker(user))],
            },
          });
        }
      }
      // A button pressed on a request's question: answered as the sender, if it is theirs.
      const press = event.type === "postback" ? readPress(event.postback?.data) : null;
      if (press?.kind === "rescue" && event.replyToken) {
        const { data: outcome } = await supabase.rpc("line_case_answer", {
          p_token: token,
          p_line_user: user,
          p_sos: press.sos,
          p_rescued: press.rescued,
        });
        const { data: who } = await supabase.rpc("line_status_for", {
          p_token: token,
          p_line_user: user,
        });
        const locale = localeOf(
          ((Array.isArray(who) ? who[0] : who) as { locale?: string } | undefined)?.locale ?? "th",
        );
        const answered = String(outcome ?? "");
        const thanks = answerSticker(answered);
        await call("/message/reply", {
          method: "POST",
          body: {
            replyToken: event.replyToken,
            messages: [
              { type: "text", text: answerText(answered, wordsOf(locale)) },
              ...(thanks ? [stickerMessage(siteUrl(), thanks)] : []),
            ],
          },
        });
        // The team's board and the sender's own page move on at once, not at the next tick.
        await runPushTick();
        continue;
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
        const sticker = statusSticker({ alerts: row.alerts ?? [] });
        await call("/message/reply", {
          method: "POST",
          body: {
            replyToken: event.replyToken,
            messages: [
              { type: "text", text },
              ...(sticker ? [stickerMessage(siteUrl(), sticker)] : []),
            ],
          },
        });
      }
    } catch {
      // One bad event must not stop the rest; LINE does not resend what was acknowledged.
    }
  }
}

const SEND_WORDS = { th: th.push.send, ms: ms.push.send, en: en.push.send } as const;

/**
 * The LINE half of the work on requests for help (A7): the offer to a team's LINE, and the
 * sender's two buttons once the team reports it done. Called from `runPushTick`, so whatever
 * wakes the web push also wakes this. One message per person, through LINE's push API; each
 * counts against the month's quota like an alert. Never throws.
 */
export async function lineCaseTick(): Promise<
  { sent: number; failed: number } | { skipped: string }
> {
  try {
    const token = gateToken();
    if (!token || !accessToken()) return { skipped: "no_keys" };
    const supabase = createPublicClient();
    const { data, error } = await supabase.rpc("line_due", { p_token: token });
    if (error || !Array.isArray(data)) return { skipped: "not_set_up" };
    let sent = 0;
    let failed = 0;
    const owed: { to: string; message: Record<string, unknown> }[] = [];
    for (const row of data as (DueRow & { line_user_id: string })[]) {
      const locale = localeOf(row.locale);
      const message = caseLineMessage(row, SEND_WORDS[locale], wordsOf(locale), siteUrl());
      if (message) owed.push({ to: row.line_user_id, message });
    }
    // An admin's decision on something the person was waiting for (owner, 15 Oct): a team's
    // registration, a team's field-rescue record, a flood report. Same words as the bell.
    const decided = await supabase.rpc("line_decisions_due", { p_token: token });
    if (!decided.error && Array.isArray(decided.data)) {
      for (const row of decided.data as (DecisionRow & { line_user_id: string })[]) {
        const locale = localeOf(row.locale);
        const message = decisionLineMessage(
          { ...row, locale },
          ALL[locale].notices as unknown as DecisionWords,
          wordsOf(locale),
          siteUrl(),
        );
        if (message) owed.push({ to: row.line_user_id, message });
      }
    }
    for (const { to, message } of owed) {
      const retryKey = randomUUID();
      let ok = false;
      for (let attempt = 0; attempt < 3 && !ok; attempt++) {
        try {
          const r = await call("/message/push", {
            method: "POST",
            body: { to, messages: [message] },
            retryKey,
          });
          ok = r.ok || r.status === 409;
          if (!ok && r.status < 500) break;
        } catch {
          // A timeout or a dropped connection: try again with the same key.
        }
      }
      if (ok) sent++;
      else failed++;
    }
    return { sent, failed };
  } catch {
    return { skipped: "error" };
  }
}

/**
 * Send an approved admin their way in over LINE (owner, 16 Oct 2026).
 *
 * Called twice over, on purpose: by the super admin's approval, and again when that person
 * next signs in. Whichever comes first wins, because `admin_welcome_target` gives nothing once
 * `line_sent_at` is set and only answers at all when Jaga already knows their LINE account.
 * Never throws: the role is theirs whether or not LINE takes the message, and the console is
 * on their account page either way.
 */
export async function sendAdminWelcome(
  supabase: SupabaseClient,
  memberId: string,
): Promise<boolean> {
  if (!accessToken()) return false;
  try {
    const { data } = await supabase.rpc("admin_welcome_target", { p_member_id: memberId });
    const row = ((data as Record<string, unknown>[]) ?? [])[0];
    const to = row && typeof row.line_user_id === "string" ? row.line_user_id : "";
    if (!row || !to) return false;
    const locale = localeOf(typeof row.locale === "string" ? row.locale : "th");
    const message = adminWelcomeMessage(
      wordsOf(locale).adminWelcome,
      locale,
      typeof row.duty === "string" ? row.duty : "",
      siteUrl(),
    );
    if (!(await multicast([to], message))) return false;
    await supabase.rpc("admin_welcome_sent", { p_member_id: memberId });
    return true;
  } catch {
    return false;
  }
}
