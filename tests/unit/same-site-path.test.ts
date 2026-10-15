import { describe, expect, it } from "vitest";
import { sameSitePath, signInHref } from "@/lib/sign-in-link";

describe("sameSitePath (where a person goes after signing in)", () => {
  it("keeps an ordinary path with its query and anchor", () => {
    expect(sameSitePath("/account/places?x=1#top")).toBe("/account/places?x=1#top");
    expect(sameSitePath("/en/map")).toBe("/en/map");
  });

  it("refuses another site, however it is written", () => {
    for (const bad of [
      "//evil.com",
      "https://evil.com",
      "/\\evil.com",
      "/\t/evil.com",
      "/\n/evil.com",
      "/\r/evil.com",
      "/ /evil.com",
      "javascript:alert(1)",
      "evil.com",
      "",
      null,
      undefined,
    ]) {
      expect(sameSitePath(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("every refused value parses to this site, so nothing refused here could have been safe", () => {
    // The fault this guards: browsers drop tabs and newlines before reading a URL.
    expect(new URL("/\t/evil.com", "https://jagaapp.org").origin).toBe("https://evil.com");
  });

  it("the sign-in link falls back to home for a path that would leave the site", () => {
    expect(signInHref("th", "/\t/evil.com")).toBe("/sign-in?next=%2F");
  });
});
