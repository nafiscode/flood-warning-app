import { fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SoundGuideView } from "@/components/push/SoundGuide";
import { SOUND_STEPS, soundGuide, type SoundGuide } from "@/lib/quiet";
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

/**
 * Hearing the notification (the owner, 21 Oct). Jaga cannot choose the sound a closed phone
 * makes; where the person can, the steps differ by how Jaga was opened, which is the one real
 * reason to add it to the home screen.
 */
describe("which sound guide a device gets", () => {
  it("depends on the phone, and on Android on whether Jaga is installed", () => {
    expect(soundGuide(ANDROID, true, 5)).toBe("androidApp");
    expect(soundGuide(ANDROID, false, 5)).toBe("androidWeb");
    // An iPhone plays the standard sound either way, so installing changes nothing here.
    expect(soundGuide(IPHONE, true, 5)).toBe("ios");
    expect(soundGuide(IPHONE, false, 5)).toBe("ios");
  });

  it("gives a computer none: a site has no such setting there", () => {
    expect(soundGuide(LAPTOP, false, 0)).toBeNull();
    expect(soundGuide(LAPTOP, true, 0)).toBeNull();
  });
});

describe("the words of the sound guide", () => {
  const GUIDES: SoundGuide[] = ["androidApp", "androidWeb", "ios"];

  it("has every step in all three languages", () => {
    for (const messages of [th, ms, en]) {
      const sound = messages.push.sound as Record<string, unknown>;
      expect(sound.button).toBeTruthy();
      expect(sound.intro).toBeTruthy();
      // The two lines that say what Jaga cannot do, and what it does instead.
      expect(sound.cannot).toBeTruthy();
      expect(sound.repeat).toBeTruthy();
      for (const guide of GUIDES) {
        const steps = sound[guide] as Record<string, string>;
        for (let i = 1; i <= SOUND_STEPS[guide]; i += 1) {
          expect(steps[`s${i}`]).toBeTruthy();
        }
      }
    }
  });

  it("opens from its own button and shows that phone's steps", () => {
    const { getByRole, container } = renderWithIntl(<SoundGuideView guide="androidApp" />);
    const button = getByRole("button");
    expect(container.querySelector("[data-sound-steps]")).toBeNull();
    fireEvent.click(button);
    const list = container.querySelector("[data-sound-steps]");
    expect(list?.getAttribute("data-sound-steps")).toBe("androidApp");
    expect(list?.querySelectorAll("li")).toHaveLength(SOUND_STEPS.androidApp);
  });

  it("gives the browser guide a step fewer, and it is the one about installing", () => {
    expect(SOUND_STEPS.androidWeb).toBe(SOUND_STEPS.androidApp - 1);
    for (const messages of [th, ms, en]) {
      const { androidWeb } = messages.push.sound;
      // The extra step the installed guide does not need: how to give Jaga a sound of its own.
      expect(androidWeb.s3.length).toBeGreaterThan(0);
    }
  });
});
