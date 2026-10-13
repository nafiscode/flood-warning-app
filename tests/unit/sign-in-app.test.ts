import { describe, expect, it } from "vitest";
import { FLOW_COOKIE, lineHrefFor, runsAsApp, shouldAskForSignIn } from "@/lib/flow-cookie";
import { returnToAppPath, unpackClaim } from "@/lib/sign-in-flow";

const FLOW = "A".repeat(43);
const NAME = "sb-abc-auth-token-code-verifier";

describe("a LINE sign-in started in Jaga on the home screen (owner, 13 Oct)", () => {
  it("knows when it runs from the home screen, on an iPhone and elsewhere", () => {
    expect(runsAsApp({ navigator: { standalone: true } })).toBe(true);
    expect(
      runsAsApp({ matchMedia: (q) => ({ matches: q === "(display-mode: standalone)" }) }),
    ).toBe(true);
    expect(runsAsApp({ matchMedia: () => ({ matches: false }), navigator: {} })).toBe(false);
    expect(runsAsApp({})).toBe(false);
  });

  it("marks the link only there, and only once", () => {
    expect(lineHrefFor("/api/auth/line?locale=th", false)).toBe("/api/auth/line?locale=th");
    expect(lineHrefFor("/api/auth/line?locale=th", true)).toBe("/api/auth/line?locale=th&app=1");
    expect(lineHrefFor("/api/auth/line?locale=th&app=1", true)).toBe(
      "/api/auth/line?locale=th&app=1",
    );
    expect(lineHrefFor("/api/auth/line", true)).toBe("/api/auth/line?app=1");
  });

  it("asks for a waiting sign-in only while one was started and the app is on screen", () => {
    const cookie = `NEXT_LOCALE=th; ${FLOW_COOKIE}=${FLOW}`;
    expect(shouldAskForSignIn(cookie, "/sign-in", true)).toBe(true);
    expect(shouldAskForSignIn(cookie, "/en", true)).toBe(true);
    expect(shouldAskForSignIn(cookie, "/sign-in", false)).toBe(false);
    expect(shouldAskForSignIn("NEXT_LOCALE=th", "/sign-in", true)).toBe(false);
    // Another cookie whose name merely ends the same way is not it.
    expect(shouldAskForSignIn(`not-${FLOW_COOKIE}=x`, "/sign-in", true)).toBe(false);
  });

  it("never pulls anyone away from a request for help (safety rule 1)", () => {
    const cookie = `${FLOW_COOKIE}=${FLOW}`;
    for (const path of ["/sos", "/sos/abc", "/en/sos", "/ms/report", "/supplies", "/th/supplies"]) {
      expect(shouldAskForSignIn(cookie, path, true)).toBe(false);
    }
    // A page that only starts with the same letters is not one of them.
    expect(shouldAskForSignIn(cookie, "/sosial", true)).toBe(true);
  });

  it("sends the phone's browser to the 'go back to Jaga' page, in the person's language", () => {
    expect(returnToAppPath(FLOW, null)).toBe(`/account/return-to-app?flow=${FLOW}`);
    expect(returnToAppPath(FLOW, "/en/account")).toBe(
      `/en/account/return-to-app?flow=${FLOW}&next=%2Fen%2Faccount`,
    );
  });

  it("reads what the database hands back, and nothing malformed", () => {
    expect(unpackClaim({ code: "c1", verifier: JSON.stringify([[NAME, "v"]]) })).toEqual({
      code: "c1",
      verifier: [{ name: NAME, value: "v" }],
    });
    expect(unpackClaim({ code: "c1", verifier: "junk" })).toEqual({ code: "c1", verifier: [] });
    for (const bad of [null, undefined, "x", {}, { code: "" }, { code: 5 }]) {
      expect(unpackClaim(bad)).toBeNull();
    }
  });
});
