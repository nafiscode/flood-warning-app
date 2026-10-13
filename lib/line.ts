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
};

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
  const body = alert.messages[locale] ?? alert.messages.th ?? "";
  if (!level || !body) return null;
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
      clip(a.messages[locale] ?? a.messages.th ?? "", 600),
      next ? words.nextUpdate.replace("{time}", next) : "",
    ]
      .filter(Boolean)
      .join("\n");
  });
  return clip([words.statusHead, ...lines].join("\n\n"), 4800);
}
