import { fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PushCardView } from "@/components/push/PushCard";
import { QuietDemo, QuietGuideView } from "@/components/push/QuietGuide";
import type { PushState } from "@/lib/push";
import { QUIET_FRAMES, QUIET_STEPS, quietGuide } from "@/lib/quiet";
import en from "@/messages/en.json";
import ms from "@/messages/ms.json";
import th from "@/messages/th.json";
import { renderWithIntl } from "./render";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const ANDROID =
  "Mozilla/5.0 (Linux; Android 14; SM-A155F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36";
const LAPTOP =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const IPAD =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";

describe("which Do Not Disturb guide a device gets", () => {
  it("a phone gets its own system's, a computer none", () => {
    expect(quietGuide(IPHONE, 5)).toBe("ios");
    expect(quietGuide(ANDROID, 5)).toBe("android");
    expect(quietGuide(LAPTOP, 0)).toBeNull();
    // An iPad says it is a Mac; its touch screen tells them apart.
    expect(quietGuide(IPAD, 5)).toBe("ios");
    expect(quietGuide(IPAD, 0)).toBeNull();
  });

  it("every step is written in all three languages", () => {
    for (const messages of [th, ms, en]) {
      for (const guide of ["ios", "android"] as const) {
        const steps = messages.push.quiet[guide];
        expect(Object.keys(steps)).toHaveLength(QUIET_STEPS);
        for (const text of Object.values(steps)) expect(text.length).toBeGreaterThan(5);
      }
    }
  });
});

describe("the guide under the notifications card", () => {
  it("is folded until asked for, then shows the picture, the steps and the honest limits", () => {
    const { container, getByText } = renderWithIntl(<QuietGuideView guide="ios" />, "en");
    const button = container.querySelector("[data-quiet-button]")!;
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector("[data-quiet-demo]")).toBeNull();
    fireEvent.click(button);
    expect(container.querySelector("[data-quiet-demo]")!.getAttribute("data-frame")).toBe("0");
    expect(container.querySelectorAll("[data-quiet-steps] li")).toHaveLength(QUIET_STEPS);
    getByText(en.push.quiet.intro);
    getByText(en.push.quiet.sound);
    expect(container.textContent).not.toContain(en.push.quiet.brands);
  });

  it("tapping a step shows its picture and stops the pictures changing", () => {
    const { container } = renderWithIntl(<QuietGuideView guide="android" startOpen />, "en");
    expect(container.textContent).toContain(en.push.quiet.brands);
    const steps = container.querySelectorAll("[data-quiet-steps] button");
    fireEvent.click(steps[2]!);
    expect(container.querySelector("[data-quiet-demo]")!.getAttribute("data-frame")).toBe("2");
    expect(steps[2]!.getAttribute("aria-current")).toBe("step");
    expect(container.querySelector("[data-quiet-play]")!.getAttribute("data-quiet-play")).toBe(
      "off",
    );
  });

  it("the picture is decoration, wears no alert colour and ends on the notification", () => {
    for (const guide of ["ios", "android"] as const) {
      for (let frame = 0; frame < QUIET_FRAMES; frame++) {
        const { container, unmount } = renderWithIntl(<QuietDemo guide={guide} frame={frame} />);
        const demo = container.querySelector("[data-quiet-demo]")!;
        expect(demo.getAttribute("aria-hidden")).toBe("true");
        expect(demo.getAttribute("data-frame")).toBe(String(frame));
        expect(demo.innerHTML).not.toMatch(/alert-|bg-sos/);
        expect(demo.querySelector("[data-demo-result]") !== null).toBe(frame === QUIET_STEPS);
        unmount();
      }
    }
  });
});

describe("where the guide appears on the notifications card", () => {
  const view = (state: PushState, extra: Record<string, unknown> = {}) =>
    renderWithIntl(
      <PushCardView
        state={state}
        place="home"
        hasArea
        busy={false}
        failed={false}
        onEnable={() => {}}
        onDisable={() => {}}
        quiet="ios"
        {...extra}
      />,
      "en",
    ).container;

  it("with the button to turn notifications on, folded", () => {
    const c = view("ask");
    expect(c.querySelector("[data-push-enable]")).not.toBeNull();
    expect(c.querySelector("[data-quiet-button]")!.getAttribute("aria-expanded")).toBe("false");
  });

  it("stays, open, on the home screen right after they were turned on", () => {
    expect(view("on").innerHTML).toBe("");
    const c = view("on", { justOn: true });
    expect(c.querySelector("[data-quiet-demo]")).not.toBeNull();
  });

  it("not where notifications cannot work yet, and not on a computer", () => {
    expect(view("blocked", { place: "account" }).querySelector("[data-quiet]")).toBeNull();
    expect(view("needsInstall").querySelector("[data-quiet]")).toBeNull();
    expect(view("ask", { quiet: null }).querySelector("[data-quiet]")).toBeNull();
  });

  it("a request's page keeps it after turning on, without a button to turn them off", () => {
    const c = view("on", { place: "case", justOn: true });
    expect(c.querySelector("[data-quiet]")).not.toBeNull();
    expect(c.textContent).not.toContain(en.push.off);
  });
});
