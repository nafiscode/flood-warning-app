import { describe, expect, it } from "vitest";
import { homeStage, setupSteps } from "@/lib/home-stage";

const base = { hasHome: true, signedIn: false, installPending: true, tense: false };

describe("which home screen a laptop shows", () => {
  it("shows the one-question screen until there is an area", () => {
    expect(homeStage({ ...base, hasHome: false })).toBe("first");
    // Signing in does not change what is asked first: the area.
    expect(homeStage({ ...base, hasHome: false, signedIn: true })).toBe("first");
  });

  it("shows the status and the setup card while setup is unfinished", () => {
    expect(homeStage(base)).toBe("area");
    // Signed in but not installed: the install step is still open.
    expect(homeStage({ ...base, signedIn: true })).toBe("area");
    // Installed (or "Not now", or already open as an app) but not signed in: sign-in is open.
    expect(homeStage({ ...base, installPending: false })).toBe("area");
  });

  it("goes quiet for good once there is nothing left to set up", () => {
    expect(homeStage({ ...base, signedIn: true, installPending: false })).toBe("member");
  });

  it("never invites anyone to anything while a place is at Warning or Evacuate", () => {
    expect(homeStage({ ...base, tense: true })).toBe("tense");
    expect(homeStage({ ...base, hasHome: false, tense: true })).toBe("tense");
    expect(homeStage({ ...base, signedIn: true, installPending: false, tense: true })).toBe(
      "tense",
    );
  });
});

describe("the setup card's steps", () => {
  it("opens one step at a time, in order", () => {
    expect(setupSteps(base)).toEqual([
      { key: "area", state: "done" },
      { key: "signIn", state: "open" },
      { key: "install", state: "wait" },
    ]);
  });

  it("makes install the open step once the person has signed in", () => {
    expect(setupSteps({ ...base, signedIn: true })).toEqual([
      { key: "area", state: "done" },
      { key: "signIn", state: "done" },
      { key: "install", state: "open" },
    ]);
  });

  it("keeps sign-in open when install is already out of the way", () => {
    expect(setupSteps({ ...base, installPending: false })).toEqual([
      { key: "area", state: "done" },
      { key: "signIn", state: "open" },
      { key: "install", state: "done" },
    ]);
  });

  it("has nothing open when everything is done", () => {
    const steps = setupSteps({ hasHome: true, signedIn: true, installPending: false });
    expect(steps.every((s) => s.state === "done")).toBe(true);
  });
});
