import { alertWords, fillArea } from "@/lib/alert-words";
import { alert as ALERT_COLOURS } from "@/lib/brand/tokens";
import { clip, type PushLevel } from "@/lib/push";

/**
 * LINE messages (A7), the parts with no network and no key in them, so they can be tested.
 *
 * LINE is the second road for an alert, after web push, and it is billed per person reached:
 * Jaga never broadcasts, it sends one message per alert to the people that alert concerns
 * (spec 4.8). The message is the alert's own reviewed words under its level, in the alert
 * palette, with the level always written out - never colour alone.
 */
export const LINE_BATCH = 500;

/** The words a LINE message needs besides the alert's own: the `line` group of a language. */
export type LineWords = {
  open: string;
  nextUpdate: string;
  /** "your area", put where the alert's own text lists its tambons. */
  yourArea: string;
  /** "This alert covers {count} subdistricts…", under the message. */
  covers: string;
  statusHead: string;
  statusNone: string;
  statusUnknown: string;
  statusNoPlaces: string;
};

export type LineAlert = {
  id: string;
  level: string;
  messages: Record<string, string>;
  nextUpdateAt: string | null;
  /**
   * The reviewed template the alert was made from, per language, with its "{area}" still in it.
   * With it, the message says "your area" where the app lists the alert's tambons: a LINE
   * message is sent to one person about their own places, and a list of other people's tambons
   * tells them nothing. Without it (an alert not made from a template) the stored words stand.
   */
  template?: Record<string, string> | null;
  /** How many tambons the alert covers, said under the message when it is more than one. */
  tambons?: number;
};

/**
 * The alert's words for one person: the reviewed template with "your area" in place of the list
 * of tambons. Nothing else of the reviewed text is touched. Null when there is no template for
 * that language or it names no area.
 */
export function personalBody(
  template: Record<string, string> | null | undefined,
  locale: string,
  yourArea: string,
): string | null {
  const text = template?.[locale];
  if (!text || !text.includes("{area}") || !yourArea) return null;
  return fillArea(text, yourArea);
}

const CLOCK = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Bangkok",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** "20/11 14:05" in Thailand's time, or "" for a missing or broken time. */
export function lineTime(iso: string | null): string {
  if (!iso) return "";
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? "" : CLOCK.format(at).replace(",", "");
}

/** The ids in groups LINE accepts in one call, with repeats removed. */
export function batches<T>(ids: readonly T[], size = LINE_BATCH): T[][] {
  const unique = [...new Set(ids)];
  const out: T[][] = [];
  for (let i = 0; i < unique.length; i += size) out.push(unique.slice(i, i + size));
  return out;
}

/**
 * One alert as a LINE Flex message in one language: the level across the top in its own colour
 * and in words, the reviewed message, when the next update is due, and a button into Jaga.
 * Null for a level that is never sent, or an alert with no words.
 */
export function alertFlex(
  alert: LineAlert,
  locale: string,
  levelName: string,
  words: LineWords,
  site: string,
): Record<string, unknown> | null {
  const level = (["watch", "warning", "evacuate", "return"] as PushLevel[]).find(
    (l) => l === alert.level,
  );
  const body =
    personalBody(alert.template, locale, words.yourArea) ??
    alert.messages[locale] ??
    alert.messages.th ??
    "";
  if (!level || !body) return null;
  const covers =
    (alert.tambons ?? 0) > 1 ? words.covers.replace("{count}", String(alert.tambons)) : "";
  const colour = ALERT_COLOURS[level];
  const next = lineTime(alert.nextUpdateAt);
  return {
    type: "flex",
    // What a phone shows in the chat list and the notification, where the bubble cannot draw.
    altText: clip(`Jaga · ${levelName}: ${body}`, 380),
    contents: {
      type: "bubble",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: colour.bg,
        paddingAll: "16px",
        contents: [
          { type: "text", text: "Jaga", size: "sm", weight: "bold", color: colour.fg },
          {
            type: "text",
            text: levelName,
            size: "xl",
            weight: "bold",
            color: colour.fg,
            wrap: true,
          },
        ],
      },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          { type: "text", text: clip(body, 1200), wrap: true, size: "md" },
          ...(covers
            ? [{ type: "text", text: covers, wrap: true, size: "sm", color: "#5B6B78" }]
            : []),
          ...(next
            ? [
                {
                  type: "text",
                  text: words.nextUpdate.replace("{time}", next),
                  wrap: true,
                  size: "sm",
                  color: "#5B6B78",
                },
              ]
            : []),
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "button",
            style: "primary",
            color: "#1D3B53",
            action: {
              type: "uri",
              label: words.open,
              uri: `${site}${locale === "th" ? "/" : `/${locale}`}`,
            },
          },
        ],
      },
    },
  };
}

export type LineStatus = {
  known: boolean;
  hasPlaces: boolean;
  alerts: { level: string; messages: Record<string, string>; next_update_at: string | null }[];
};

/**
 * The answer to someone asking for their area's status in the LINE chat, as plain text. No
 * alert is never worded as "no risk" (safety rule 10), and the hotlines are in every answer.
 */
export function statusText(
  status: LineStatus,
  locale: string,
  levelName: (level: string) => string,
  words: LineWords,
): string {
  if (!status.known) return words.statusUnknown;
  if (!status.hasPlaces) return words.statusNoPlaces;
  if (status.alerts.length === 0) return words.statusNone;
  const lines = status.alerts.slice(0, 5).map((a) => {
    const next = lineTime(a.next_update_at);
    return [
      `【${levelName(a.level)}】`,
      clip(alertWords(a.messages, locale, words.yourArea), 600),
      next ? words.nextUpdate.replace("{time}", next) : "",
    ]
      .filter(Boolean)
      .join("\n");
  });
  return clip([words.statusHead, ...lines].join("\n\n"), 4800);
}
