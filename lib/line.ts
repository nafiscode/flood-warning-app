import { alertWords, fillArea } from "@/lib/alert-words";
import { alert as ALERT_COLOURS } from "@/lib/brand/tokens";
import { casePayload, clip, type DueRow, type PushLevel } from "@/lib/push";

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
  /** Labels on LINE buttons: 20 characters at most, LINE's own limit. */
  openBoard: string;
  confirmAsk: string;
  confirmAskSupplies: string;
  confirmYes: string;
  confirmNo: string;
  confirmYesSupplies: string;
  confirmNoSupplies: string;
  answeredYes: string;
  answeredNo: string;
  answeredClosed: string;
  answeredNotYours: string;
  menuStatus: string;
  menuPlaces: string;
  menuSos: string;
  menuMap: string;
  menuUnit: string;
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

/** LINE's limit for a button's label, in characters. */
export const LINE_LABEL_MAX = 20;

/**
 * A request for help as a LINE message (A7):
 *  - to a team, the offer: what and where (a tambon, never the place or the person), and a
 *    button onto the board, where the rest is behind the sign-in;
 *  - to the sender, once the team reports it done: two buttons, "yes, I have been helped" and
 *    "no, I still need help", answered in the chat itself (spec 5.4).
 * `send` is the `push.send` group of the same language, so LINE and the phone say the same.
 */
export function caseLineMessage(
  row: DueRow,
  send: Record<string, string>,
  words: LineWords,
  site: string,
): Record<string, unknown> | null {
  const supplies = row.data?.request === "supplies";
  if (row.kind === "offer") {
    const p = casePayload(row, send);
    if (!p) return null;
    return {
      type: "template",
      altText: clip(`${p.title}. ${p.body}`, 380),
      template: {
        type: "buttons",
        title: clip(p.title, 40),
        text: clip(p.body, 120),
        actions: [{ type: "uri", label: words.openBoard, uri: `${site}${p.url}` }],
      },
    };
  }
  if (row.kind === "rescued") {
    if (!/^[0-9a-f-]{36}$/i.test(row.sos_id)) return null;
    const ask = (supplies ? words.confirmAskSupplies : words.confirmAsk).replace(
      "{unit}",
      row.data?.unit || send.aTeam || "",
    );
    const yes = supplies ? words.confirmYesSupplies : words.confirmYes;
    const no = supplies ? words.confirmNoSupplies : words.confirmNo;
    return {
      type: "template",
      altText: clip(ask, 380),
      template: {
        type: "confirm",
        text: clip(ask, 240),
        actions: [
          { type: "postback", label: yes, data: `rescue:${row.sos_id}:yes`, displayText: yes },
          { type: "postback", label: no, data: `rescue:${row.sos_id}:no`, displayText: no },
        ],
      },
    };
  }
  return null;
}

/** One admin decision owed to someone's LINE, as line_decisions_due() gives it. */
export type DecisionRow = {
  kind: string;
  locale: string;
  ref: string;
  data: Record<string, string | null> | null;
};

/** The words of a decision: the `notices` group of a language (the bell says the same). */
export type DecisionWords = {
  unit: { title: string; verified: string; suspended: string };
  field: { title: string; approved: string; rejected: string };
  report: { title: string; approved: string; hidden: string };
  yourArea: string;
};

/**
 * An admin's decision as a LINE message (owner, 15 Oct): a team's registration verified or
 * suspended, a team's field-rescue record approved or refused, a flood report checked or taken off
 * the map. The same words as the bell, and one button into Jaga where the rest is shown. It names
 * the team or the tambon, never a person or a place.
 */
export function decisionLineMessage(
  row: DecisionRow,
  words: DecisionWords,
  line: LineWords,
  site: string,
): Record<string, unknown> | null {
  const d = row.data ?? {};
  const tambon = (row.locale === "th" ? d.tambon_th : d.tambon_en) || d.tambon_th || words.yourArea;
  const unit = d.unit ?? "";
  const parts: Record<string, [string, string, string]> = {
    unit_verified: [words.unit.title, words.unit.verified.replace("{name}", unit), "/authority"],
    unit_suspended: [words.unit.title, words.unit.suspended.replace("{name}", unit), "/requests"],
    field_approved: [words.field.title, words.field.approved, "/authority/field-rescue"],
    field_rejected: [words.field.title, words.field.rejected, "/authority/field-rescue"],
    report_approved: [
      words.report.title,
      words.report.approved.replace("{tambon}", tambon),
      "/requests",
    ],
    report_hidden: [
      words.report.title,
      words.report.hidden.replace("{tambon}", tambon),
      "/requests",
    ],
  };
  const part = parts[row.kind];
  if (!part) return null;
  const [title, body, path] = part;
  const locale = row.locale === "ms" || row.locale === "en" ? row.locale : "th";
  // Thai is the default language and has no prefix in Jaga's addresses.
  const url = `${site}${locale === "th" ? "" : `/${locale}`}${path}`;
  const text = `${title}
${body}`;
  return {
    type: "template",
    altText: clip(text, 380),
    template: {
      type: "buttons",
      text: clip(text, 160),
      actions: [{ type: "uri", label: line.open, uri: url }],
    },
  };
}

/** What a LINE button pressed means: the area status, or an answer about one request. */
export type LinePress =
  { kind: "status" } | { kind: "rescue"; sos: string; rescued: boolean } | { kind: "other" };

export function readPress(data: unknown): LinePress {
  if (data === "status") return { kind: "status" };
  const m = typeof data === "string" ? /^rescue:([0-9a-f-]{36}):(yes|no)$/i.exec(data) : null;
  return m ? { kind: "rescue", sos: m[1]!, rescued: m[2] === "yes" } : { kind: "other" };
}

/**
 * Jaga's own stickers (Ja and Ga, drawn for the LINE sticker sets) sent as pictures in the
 * chat's free replies. LINE's Messaging API cannot send a sticker of a set made on Creators
 * Market, so they go as images served from the site. Never next to an alert in force: a
 * cheerful picture beside a warning would soften it.
 */
export const LINE_STICKERS = ["hello-ja", "hello-ga", "take-care", "together"] as const;
export type LineSticker = (typeof LINE_STICKERS)[number];

export function stickerMessage(site: string, name: LineSticker) {
  const url = `${site.replace(/\/+$/, "")}/line/stickers/${name}.png`;
  return { type: "image" as const, originalContentUrl: url, previewImageUrl: url };
}

/** A new friend is greeted by Ja or Ga, the same one each time for the same person. */
export function greetingSticker(lineUser: string): LineSticker {
  let sum = 0;
  for (const c of lineUser) sum += c.charCodeAt(0);
  return sum % 2 ? "hello-ga" : "hello-ja";
}

/** "Jaga diri, Jaga jiran" under a status answer, only when no alert is in force there. */
export function statusSticker(status: Pick<LineStatus, "alerts">): LineSticker | null {
  return status.alerts.length === 0 ? "take-care" : null;
}

/** "Take care of each other" once the sender confirms they were rescued; nothing otherwise. */
export function answerSticker(outcome: string): LineSticker | null {
  return outcome === "confirmed" ? "together" : null;
}

/** The chat's answer once a request's button has been pressed. */
export function answerText(outcome: string, words: LineWords): string {
  return outcome === "confirmed"
    ? words.answeredYes
    : outcome === "disputed"
      ? words.answeredNo
      : outcome === "closed"
        ? words.answeredClosed
        : words.answeredNotYours;
}
