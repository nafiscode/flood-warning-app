# Send SMS hook

Sends sign-in codes (OTP) by SMS for Supabase phone auth, through one provider adapter.

**Status: built, not deployed.** Phone sign-in goes live after launch, once the owner has chosen an SMS provider (decision 2026-09-30). Until then the phone form is hidden in production (`lib/features.ts`).

## Parts

- `lib.ts`: the `SmsProvider` interface, the console adapter, signature check, payload parsing and the SMS text. No Deno or network code, so the web app's unit tests cover it (`tests/unit/send-sms.test.ts`).
- `index.ts`: the hook itself. Verifies the signature, checks the send limit in the database (`otp_send_allowed`, 5 codes an hour per phone), then calls the adapter.

## Adding the real provider (after launch)

1. Write an adapter class implementing `SmsProvider` in `lib.ts` (one `send(to, message)` method calling the provider's HTTPS API) and add its name to `chooseProvider`.
2. Set the secrets: `SEND_SMS_HOOK_SECRET` (from the dashboard, step 4), `SMS_PROVIDER=<name>`, the provider's API key, and `JAGA_ENV=production` on the live project.
3. Deploy: `npx supabase functions deploy send-sms --no-verify-jwt --project-ref <ref>` (needs a Supabase access token; the signature check replaces the JWT check).
4. Dashboard → Authentication → Sign In / Providers → Phone: enable. Authentication → Hooks → Send SMS hook: HTTPS, the function's URL; copy the generated secret into step 2.
5. Set `JAGA_PHONE_SIGN_IN=1` for the web app and test with a real phone on each Thai network.

The console adapter prints the code to the function log and refuses to run when `JAGA_ENV=production`.

## Limits

- Per phone: 5 codes an hour, enforced here.
- Per network address: the hook request doesn't include the caller's address, so this relies on Supabase Auth's own rate limits (Dashboard → Authentication → Rate Limits). Check those values when phone sign-in is switched on.
