import { describe, expect, it } from "vitest";
import en from "@/messages/en.json";
import ms from "@/messages/ms.json";
import th from "@/messages/th.json";

/**
 * The admin's team editor (owner, 26 Nov 2026) is words only on the way in: no hardcoded string
 * anywhere on the page. These checks keep the three languages in step, so a line added in one
 * does not leave a blank in another on a phone in a district office.
 */
const LOCALES = { th, en, ms } as const;

function flatten(value: unknown, prefix = ""): Record<string, string> {
  if (typeof value === "string") return { [prefix]: value };
  if (value && typeof value === "object") {
    return Object.assign(
      {},
      ...Object.entries(value).map(([k, v]) => flatten(v, prefix ? `${prefix}.${k}` : k)),
    );
  }
  return {};
}

const editOf = (m: typeof en) => flatten(m.admin.authorities.edit);
const placeholders = (text: string) => [...text.matchAll(/\{(\w+)[,}]/g)].map((m) => m[1]).sort();

describe("admin.authorities.edit", () => {
  it("has the same keys in Thai, Malay and English", () => {
    const keys = Object.keys(editOf(en)).sort();
    expect(keys.length).toBeGreaterThan(15);
    expect(Object.keys(editOf(th)).sort()).toEqual(keys);
    expect(Object.keys(editOf(ms)).sort()).toEqual(keys);
  });

  it("has no empty line, and the same placeholders in every language", () => {
    const base = editOf(en);
    for (const [name, messages] of Object.entries(LOCALES)) {
      const mine = editOf(messages);
      for (const [key, text] of Object.entries(mine)) {
        expect(text.trim(), `${name}: ${key}`).not.toBe("");
        expect(placeholders(text), `${name}: ${key}`).toEqual(placeholders(base[key]!));
      }
    }
  });

  it("says how many units share the organization, in every language", () => {
    for (const [name, messages] of Object.entries(LOCALES)) {
      const text = messages.admin.authorities.edit.orgShared;
      expect(text, name).toContain("{count, plural,");
      expect(text, name).toContain("=1 {");
      expect(text, name).toContain("other {");
    }
  });
});
