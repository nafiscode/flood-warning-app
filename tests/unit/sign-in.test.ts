import { describe, expect, it } from "vitest";
import { isPhoneBrowser } from "@/lib/features";
import { normalizePhone } from "@/lib/phone";
import { isSessionCookie } from "@/lib/supabase/env";

describe("normalizePhone", () => {
  it("turns Thai numbers as people type them into the international form", () => {
    expect(normalizePhone("081-234-5678")).toBe("+66812345678");
    expect(normalizePhone(" 0812345678 ")).toBe("+66812345678");
    expect(normalizePhone("+66 81 234 5678")).toBe("+66812345678");
    expect(normalizePhone("66812345678")).toBe("+66812345678");
    expect(normalizePhone("073 123 456")).toBe("+6673123456");
  });

  it("keeps other countries' numbers typed with a plus", () => {
    expect(normalizePhone("+60 12-345 6789")).toBe("+60123456789");
  });

  it("rejects what can't be a phone number", () => {
    for (const bad of ["", "   ", "1784", "abc", "08123", "+0812345678", "0812345678901234"]) {
      expect(normalizePhone(bad)).toBeNull();
    }
  });
});

describe("session cookie detection", () => {
  it("matches Supabase session cookies, including chunks, and nothing else", () => {
    expect(isSessionCookie("sb-abcdefgh-auth-token")).toBe(true);
    expect(isSessionCookie("sb-abcdefgh-auth-token.0")).toBe(true);
    expect(isSessionCookie("sb-abcdefgh-auth-token-code-verifier")).toBe(true);
    expect(isSessionCookie("NEXT_LOCALE")).toBe(false);
  });
});

describe("isPhoneBrowser", () => {
  it("is true for phones, so LINE can hand over to its app", () => {
    for (const ua of [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
      "Mozilla/5.0 (Linux; Android 13; SM-A146P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
      "Mozilla/5.0 (Linux; Android 12; vivo 1906) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36 Line/15.14.0",
    ]) {
      expect(isPhoneBrowser(ua)).toBe(true);
    }
  });

  it("is false for computers and tablets, which get LINE's QR code", () => {
    for (const ua of [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15",
      "Mozilla/5.0 (iPad; CPU OS 17_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.0.0 Mobile/15E148 Safari/604.1",
      "Mozilla/5.0 (Linux; Android 13; SM-X200) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
      "",
      null,
      undefined,
    ]) {
      expect(isPhoneBrowser(ua)).toBe(false);
    }
  });
});
