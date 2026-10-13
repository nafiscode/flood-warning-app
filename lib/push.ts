/**
 * Web push (A7), the parts shared by the page, the service worker and the server. Nothing here
 * touches a browser API or a key, so all of it can be tested.
 *
 * A notification is the knock on the door, not the alert: it carries the level and the reviewed
 * message of an alert a person published (safety rule 2), and opening it shows the alert itself
 * with its area, issuer, time and next update (safety rule 3). A browser, not Jaga, chooses the
 * sound a notification makes.
 */
export const ALERT_LEVELS_PUSHED = ["watch", "warning", "evacuate", "return"] as const;
export type PushLevel = (typeof ALERT_LEVELS_PUSHED)[number];

/** What travels in one push message. Kept small: a push service drops anything over about 4 kB. */
export type PushPayload = {
  kind: "alert";
  title: string;
  body: string;
  /** Where a tap goes: the home screen in the phone's language. */
  url: string;
  /** One alert, one notification: a replacement takes the place of the old one. */
  tag: string;
  level: PushLevel;
};

const BODY_MAX = 240;

/** The start of a message, cut at a word where there is one, with an ellipsis when cut. */
export function clip(text: string, max = BODY_MAX): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${space > max * 0.6 ? cut.slice(0, space) : cut}…`;
}

export type PushAlert = {
  id: string;
  level: string;
  /** The reviewed template's words per language; Thai is always there. */
  messages: Record<string, string>;
};

/**
 * The notification for an alert, in one language. Null for a level that is never pushed
 * ("normal" is the absence of an alert, not news).
 */
export function alertPayload(
  alert: PushAlert,
  locale: string,
  levelName: (level: PushLevel, locale: string) => string,
): PushPayload | null {
  const level = ALERT_LEVELS_PUSHED.find((l) => l === alert.level);
  if (!level) return null;
  const body = alert.messages[locale] ?? alert.messages.th ?? "";
  if (!body) return null;
  return {
    kind: "alert",
    title: `Jaga · ${levelName(level, locale)}`,
    body: clip(body),
    url: locale === "th" ? "/" : `/${locale}`,
    tag: `alert-${alert.id}`,
    level,
  };
}

/** What the service worker was sent, or null when it is not one of ours. */
export function readPayload(raw: unknown): PushPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  if (p.kind !== "alert" || typeof p.title !== "string" || typeof p.body !== "string") return null;
  const level = ALERT_LEVELS_PUSHED.find((l) => l === p.level);
  if (!level) return null;
  return {
    kind: "alert",
    title: p.title,
    body: p.body,
    // Only a path of this app, whatever the message says.
    url: typeof p.url === "string" && /^\/(?!\/)/.test(p.url) ? p.url : "/",
    tag: typeof p.tag === "string" ? p.tag : "jaga-alert",
    level,
  };
}

/** Whether this phone can be asked, and what stands in the way when it cannot. */
export type PushState =
  | "unsupported" // this browser has no web push at all
  | "needsInstall" // an iPhone or iPad: only an installed app may ask
  | "ask" // can be asked now
  | "on"
  | "blocked"; // the person said no; only they can change it, in the phone's settings

export function pushState(env: {
  hasPush: boolean;
  permission: "default" | "granted" | "denied" | null;
  apple: boolean;
  standalone: boolean;
  subscribed: boolean;
}): PushState {
  // An iPhone in a browser tab has no push at all; added to the home screen it has.
  if (env.apple && !env.standalone) return "needsInstall";
  if (!env.hasPush || env.permission === null) return "unsupported";
  if (env.permission === "denied") return "blocked";
  if (env.permission === "granted" && env.subscribed) return "on";
  return "ask";
}

/** The public key as the bytes `pushManager.subscribe` wants. */
export function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
