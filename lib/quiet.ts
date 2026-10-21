/**
 * Letting Jaga's notifications through the phone's Do Not Disturb and Sleep. No web app can do
 * this by itself, and none can make a silenced phone ring: the person has to add Jaga to the
 * list of apps their phone lets through, once, in the phone's own settings. This file decides
 * which written steps fit the phone. It is pure, so it can be tested without a browser.
 */
import { installDevice } from "@/lib/install";

/** Whose settings the steps describe. A computer gets none: it has no such list for a web app. */
export type QuietGuide = "ios" | "android";

export function quietGuide(userAgent: string, touchPoints = 0): QuietGuide | null {
  if (installDevice(userAgent, touchPoints) !== "phone") return null;
  return /Android/.test(userAgent) ? "android" : "ios";
}

/** The written steps of each guide. */
export const QUIET_STEPS = 4;

/** One picture per written step, and a last one: the notification arriving at night. */
export const QUIET_FRAMES = QUIET_STEPS + 1;

/**
 * Making Jaga's notifications audible (the owner, 21 Oct: a drill arrived on their phone in
 * silence, and they asked whether an app added to the home screen could ring).
 *
 * It cannot: no web app can choose the sound a closed phone makes, because the web has no way
 * to put a sound on a notification and a service worker has no audio of its own. The sound a
 * notification makes is the phone's own setting, and the only thing Jaga can do is tell the
 * person where that setting is. Which is worth doing: the person who cannot hear an evacuation
 * at 2am is in the same position as one who was never sent it.
 *
 * Where the setting lives depends on how Jaga was opened, and this is the one real reason to
 * add it to the home screen:
 *  - **androidApp** - added to the home screen on Android, so Android knows Jaga as an app of
 *    its own. It has its own entry in the phone's notification settings: its sound can be
 *    chosen, and its importance raised so it sounds rather than slides in quietly.
 *  - **androidWeb** - opened in the browser, so the notifications belong to the browser and all
 *    sites share one sound. Choosing it is still possible; singling Jaga out is not.
 *  - **ios** - an iPhone plays the standard notification sound and nothing can change it, so the
 *    steps are about the things that silence it: the ring switch, the volume, and Focus.
 */
export type SoundGuide = "androidApp" | "androidWeb" | "ios";

export function soundGuide(
  userAgent: string,
  installed: boolean,
  touchPoints = 0,
): SoundGuide | null {
  const phone = quietGuide(userAgent, touchPoints);
  if (!phone) return null;
  if (phone === "ios") return "ios";
  return installed ? "androidApp" : "androidWeb";
}

/** The written steps of each guide. */
export const SOUND_STEPS: Record<SoundGuide, number> = {
  androidApp: 4,
  androidWeb: 3,
  ios: 3,
};
