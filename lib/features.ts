/**
 * Phone sign-in (SMS code) is built but stays hidden in production until an SMS provider is
 * chosen after launch (decision 2026-09-30). JAGA_PHONE_SIGN_IN=1 switches it on.
 */
export function phoneSignInEnabled(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.JAGA_PHONE_SIGN_IN === "1";
}

/** The LINE button appears once the LINE Login channel is set for this deployment. */
export function lineSignInConfigured(): boolean {
  return !!process.env.LINE_LOGIN_CHANNEL_ID;
}

/**
 * True for a phone's browser. Tablets and computers are false: an iPad's Safari presents itself
 * as a Mac, and an Android tablet's browser leaves out "Mobile".
 */
export function isPhoneBrowser(userAgent: string | null | undefined): boolean {
  return /iPhone|iPod|Android.*Mobile|Windows Phone/i.test(userAgent ?? "");
}

/**
 * The launch switch (decision 2026-10-08). Until JAGA_IN_SERVICE=1, nobody is issuing alerts, so
 * a tambon without an alert shows "not in service yet" and never Normal (safety rule 10).
 */
export function inService(): boolean {
  return process.env.JAGA_IN_SERVICE === "1";
}

/** Donations and the Transparency tab stay off until the owner turns them on (safety rule 9). */
export function donationsEnabled(): boolean {
  return process.env.JAGA_DONATIONS === "1";
}
