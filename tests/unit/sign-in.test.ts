import { describe, expect, it } from "vitest";
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
