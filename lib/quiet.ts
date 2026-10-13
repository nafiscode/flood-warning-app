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
