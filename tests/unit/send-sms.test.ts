// @vitest-environment node
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  chooseProvider,
  ConsoleSmsProvider,
  otpMessage,
  parsePayload,
  verifyWebhook,
} from "../../supabase/functions/send-sms/lib";

const KEY = Buffer.from("jaga-test-hook-secret-000000000000").toString("base64");
const SECRET = `v1,whsec_${KEY}`;
const NOW = 1_800_000_000;

function sign(id: string, timestamp: string, body: string): string {
  const mac = createHmac("sha256", Buffer.from(KEY, "base64"))
    .update(`${id}.${timestamp}.${body}`)
    .digest("base64");
  return `v1,${mac}`;
}

describe("Send SMS hook: signature", () => {
  const body = JSON.stringify({ user: { phone: "66812345678" }, sms: { otp: "123456" } });
  const headers = {
    id: "msg_1",
    timestamp: String(NOW),
    signature: sign("msg_1", String(NOW), body),
  };

  it("accepts a request signed with the hook secret", async () => {
    expect(await verifyWebhook(SECRET, headers, body, NOW)).toBe(true);
  });

  it("refuses a changed body, a wrong secret, missing headers and an old request", async () => {
    expect(await verifyWebhook(SECRET, headers, body.replace("123456", "654321"), NOW)).toBe(false);
    const other = `v1,whsec_${Buffer.from("another-secret").toString("base64")}`;
    expect(await verifyWebhook(other, headers, body, NOW)).toBe(false);
    expect(await verifyWebhook(SECRET, { ...headers, signature: null }, body, NOW)).toBe(false);
    expect(await verifyWebhook(SECRET, headers, body, NOW + 301)).toBe(false);
  });
});

describe("Send SMS hook: request and message", () => {
  it("reads the phone and the code, and adds the plus sign", () => {
    expect(
      parsePayload(JSON.stringify({ user: { phone: "66812345678" }, sms: { otp: "123456" } })),
    ).toEqual({ phone: "+66812345678", otp: "123456" });
  });

  it("rejects anything else", () => {
    for (const bad of ["", "{}", "not json", '{"user":{"phone":"x"},"sms":{"otp":"123456"}}']) {
      expect(parsePayload(bad)).toBeNull();
    }
  });

  it("keeps the Thai message within one SMS (70 characters)", () => {
    expect(otpMessage("123456")).toContain("123456");
    expect(otpMessage("12345678").length).toBeLessThanOrEqual(70);
  });
});

describe("Send SMS hook: provider", () => {
  it("uses the console adapter by default, which only logs", async () => {
    const lines: string[] = [];
    const provider = chooseProvider({}, (line) => lines.push(line));
    expect(provider).toBeInstanceOf(ConsoleSmsProvider);
    await provider.send("+66812345678", "hello");
    expect(lines).toEqual(["[sms:console] to +66812345678: hello"]);
  });

  it("refuses the console adapter in production and unknown providers", () => {
    expect(() => chooseProvider({ JAGA_ENV: "production" })).toThrow(/production/);
    expect(() => chooseProvider({ SMS_PROVIDER: "nobody" })).toThrow(/no adapter/);
  });
});
