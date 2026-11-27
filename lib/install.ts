/**
 * Putting Jaga on the phone's home screen (or a computer's desktop). No browser lets a page do
 * this by itself: Chrome, Edge and Samsung Internet hand the page an "install" dialog it may open
 * from a button; iPhones, Safari and Firefox have no such thing, so there the button can only
 * show where the browser's own "Add to Home Screen" is. This file decides which of those a
 * browser gets. It is pure, so it can be tested without a browser.
 */

/** Which written steps fit this browser, when it offers no install dialog of its own. */
export type InstallGuide =
  /** Inside Messenger, Facebook, Instagram, LINE or TikTok: those cannot add a shortcut. */
  | "inApp"
  | "iosSafari"
  /** Chrome, Edge or Firefox on an iPhone or iPad: Share sits beside the address. */
  | "iosOther"
  | "android"
  | "macSafari"
  | "desktop";

export type InstallDevice = "phone" | "computer";

const IN_APP = /FBAN|FBAV|FB_IAB|Instagram|Messenger|TikTok|musical_ly|\bLine\//i;
const IOS_OTHER = /CriOS|FxiOS|EdgiOS|OPiOS/;

/** An iPad's Safari says it is a Mac; a Mac has no touch screen, an iPad has. */
function isIos(userAgent: string, touchPoints: number): boolean {
  return /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && touchPoints > 1);
}

export function installGuide(userAgent: string, touchPoints = 0): InstallGuide {
  if (IN_APP.test(userAgent)) return "inApp";
  if (isIos(userAgent, touchPoints)) return IOS_OTHER.test(userAgent) ? "iosOther" : "iosSafari";
  if (/Android/.test(userAgent)) return "android";
  if (
    /Macintosh/.test(userAgent) &&
    /Safari\//.test(userAgent) &&
    !/Chrome|Chromium|Edg\//.test(userAgent)
  )
    return "macSafari";
  return "desktop";
}

/** Whether the words say "home screen" or "this computer". Tablets count as phones here. */
export function installDevice(userAgent: string, touchPoints = 0): InstallDevice {
  return isIos(userAgent, touchPoints) || /Android/.test(userAgent) ? "phone" : "computer";
}

/** "Not now" keeps the home screen's card away for this long, on this device only. */
export const INSTALL_LATER_MS = 21 * 24 * 3_600_000;

/** True while a "Not now" is still being honoured. `now` of 0 is the server: say nothing yet. */
export function installSnoozed(laterAt: number | null, now: number): boolean {
  return laterAt !== null && now - laterAt < INSTALL_LATER_MS;
}

/** Which wording the banner uses. Not a different offer - the same one, said in their terms. */
export type InstallReason =
  /** Notifications are on in a browser tab: say that the bell is surer from the icon. */
  | "push"
  /** They have places of their own: say those keep working with no signal. */
  | "place"
  /** They have opened Jaga before. */
  | "again"
  /** First time here. */
  | "first";

/**
 * Why the banner is being shown, from what the home screen already knows. The order is by how
 * much the person has shown they care: notifications on, then saved places, then a repeat visit.
 * Pure, so the choice can be tested without a browser.
 */
export function installReason(facts: {
  pushOn: boolean;
  savedPlaces: number;
  visits: number;
}): InstallReason {
  if (facts.pushOn) return "push";
  if (facts.savedPlaces > 0) return "place";
  return facts.visits > 1 ? "again" : "first";
}
