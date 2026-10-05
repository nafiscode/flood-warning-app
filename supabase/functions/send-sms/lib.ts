/**
 * Send SMS hook: the parts with no Deno or network dependency, so the web app's unit tests can
 * run them (tests/unit/send-sms.test.ts). Supabase Auth calls the hook with a signed request
 * (Standard Webhooks) whenever a sign-in code must be sent.
 */

/** One SMS company. Adding a provider means adding one adapter; nothing else changes. */
export interface SmsProvider {
  readonly name: string;
  /** Send `message` to `to` (international format, +66…). Throws when the provider refuses. */
  send(to: string, message: string): Promise<void>;
}

/**
 * Development adapter: writes the message to the function log instead of sending it.
 * It prints the sign-in code, so it must never run for the live project.
 */
export class ConsoleSmsProvider implements SmsProvider {
  readonly name = "console";
  constructor(private readonly log: (line: string) => void = console.log) {}
  async send(to: string, message: string): Promise<void> {
    this.log(`[sms:console] to ${to}: ${message}`);
  }
}

export type HookEnv = {
  /** "console" until the owner chooses a company (decision 2026-09-30). */
  SMS_PROVIDER?: string;
  /** "production" on the live project. */
  JAGA_ENV?: string;
};

/** The adapter for this deployment. The console adapter is refused in production. */
export function chooseProvider(env: HookEnv, log?: (line: string) => void): SmsProvider {
  const name = (env.SMS_PROVIDER ?? "console").toLowerCase();
  if (name === "console") {
    if (env.JAGA_ENV === "production") {
      throw new Error("The console SMS adapter must not run in production; set SMS_PROVIDER.");
    }
    return new ConsoleSmsProvider(log);
  }
  throw new Error(`Unknown SMS_PROVIDER "${name}": no adapter has been added for it yet.`);
}

/**
 * The text of the SMS. Thai only: the code is sent before we know the person's language, and
 * Thai text is limited to 70 characters per SMS, so there is no room for three languages.
 * Reviewed copy lives here, not in messages/*.json, because the hook is deployed on its own.
 */
export function otpMessage(otp: string): string {
  return `รหัส Jaga: ${otp} ใช้ได้ 5 นาที ห้ามบอกผู้อื่น`;
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function toBase64(bytes: ArrayBuffer): string {
  let binary = "";
  for (const b of new Uint8Array(bytes)) binary += String.fromCharCode(b);
  return btoa(binary);
}

function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export type WebhookHeaders = {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
};

/**
 * Check a Standard Webhooks signature: HMAC-SHA256 over "<id>.<timestamp>.<body>" with the
 * hook secret ("v1,whsec_<base64>" as Supabase shows it). Requests older than 5 minutes are
 * refused, so a captured request can't be replayed later.
 */
export async function verifyWebhook(
  secret: string,
  headers: WebhookHeaders,
  body: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return false;
  const sent = Number(timestamp);
  if (!Number.isFinite(sent) || Math.abs(nowSeconds - sent) > 300) return false;
  const keyText = secret.replace(/^v1,/, "").replace(/^whsec_/, "");
  let keyBytes: Uint8Array<ArrayBuffer>;
  try {
    keyBytes = fromBase64(keyText);
  } catch {
    return false;
  }
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expected = toBase64(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${timestamp}.${body}`)),
  );
  // The header may carry several signatures: "v1,<sig> v1,<sig2>".
  return signature
    .split(" ")
    .map((part) => part.split(",")[1] ?? "")
    .some((candidate) => sameText(candidate, expected));
}

export type SmsHookPayload = { phone: string; otp: string };

/** Pull the phone and the code out of the hook request; null when it isn't a usable request. */
export function parsePayload(body: string): SmsHookPayload | null {
  try {
    const data = JSON.parse(body) as { user?: { phone?: unknown }; sms?: { otp?: unknown } };
    const phone = data.user?.phone;
    const otp = data.sms?.otp;
    if (typeof phone !== "string" || typeof otp !== "string") return null;
    if (!/^\+?[0-9]{8,15}$/.test(phone) || !/^[0-9]{4,10}$/.test(otp)) return null;
    return { phone: phone.startsWith("+") ? phone : `+${phone}`, otp };
  } catch {
    return null;
  }
}
