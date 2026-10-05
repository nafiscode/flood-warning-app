/**
 * Supabase Auth "Send SMS" hook (CLAUDE.md, SMS): sends the sign-in code through the chosen
 * provider adapter. Not deployed yet: phone sign-in goes live after launch, when the owner has
 * chosen a provider (decision 2026-09-30). See README.md in this folder.
 *
 * Secrets (supabase secrets set …): SEND_SMS_HOOK_SECRET, SMS_PROVIDER, JAGA_ENV.
 * SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by the platform.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { chooseProvider, otpMessage, parsePayload, verifyWebhook } from "./lib.ts";

function reply(status: number, message: string): Response {
  // The shape Supabase Auth expects from a hook that refuses a request.
  return new Response(JSON.stringify({ error: { http_code: status, message } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (request) => {
  const secret = Deno.env.get("SEND_SMS_HOOK_SECRET");
  if (!secret) return reply(500, "The SMS hook is not configured.");

  const body = await request.text();
  const signed = await verifyWebhook(
    secret,
    {
      id: request.headers.get("webhook-id"),
      timestamp: request.headers.get("webhook-timestamp"),
      signature: request.headers.get("webhook-signature"),
    },
    body,
  );
  if (!signed) return reply(401, "Invalid signature.");

  const payload = parsePayload(body);
  if (!payload) return reply(400, "Invalid request.");

  // At most 5 codes an hour per phone, counted in the database (only a hash of the phone is
  // kept). The hook request doesn't carry the caller's network address, so the limit per
  // address is Supabase Auth's own rate limit, set in the dashboard.
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data: allowed, error } = await supabase.rpc("otp_send_allowed", {
    p_phone: payload.phone,
    p_ip: null,
  });
  if (error) return reply(500, "Could not check the send limit.");
  if (!allowed) return reply(429, "Too many codes requested for this number. Try again later.");

  try {
    const provider = chooseProvider({
      SMS_PROVIDER: Deno.env.get("SMS_PROVIDER"),
      JAGA_ENV: Deno.env.get("JAGA_ENV"),
    });
    await provider.send(payload.phone, otpMessage(payload.otp));
  } catch (e) {
    console.error(`[sms] send failed: ${e instanceof Error ? e.message : "unknown error"}`);
    return reply(502, "The SMS could not be sent.");
  }
  return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
});
