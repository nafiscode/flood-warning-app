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
 * The phone system when the page is open in another app's built-in browser (Messenger, Facebook,
 * Instagram, TikTok), else null. A LINE sign-in started there comes back from the LINE app in
 * the phone's own browser, which lacks the one-time key the sign-in was started with, so the
 * first attempt ends in "link expired" (reported 2026-10-06). LINE's own built-in browser is
 * left out: no such report for it.
 */
export function inAppBrowser(userAgent: string | null | undefined): "android" | "ios" | null {
  const ua = userAgent ?? "";
  if (!/FBAN|FBAV|FB_IAB|FBIOS|Messenger|Instagram|musical_ly|BytedanceWebview|TikTok/i.test(ua)) {
    return null;
  }
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  return /Android/i.test(ua) ? "android" : null;
}

/**
 * Whether openInBrowserHref can work in this built-in browser. On iPhones before iOS 17 Safari's
 * address scheme does nothing (seen on the owner's phone, 2026-10-07): show written steps only.
 */
export function canOpenBrowser(
  system: "android" | "ios",
  userAgent: string | null | undefined,
): boolean {
  if (system === "android") return true;
  const major = /\bOS (\d+)_/.exec(userAgent ?? "")?.[1];
  return major !== undefined && Number(major) >= 17;
}

/**
 * A link that opens `url` in the phone's own browser from inside another app's built-in one.
 * Android: an intent link, which the system hands to the default browser. iPhone: Safari's own
 * address scheme (iOS 17 and later; on older ones the link does nothing).
 */
export function openInBrowserHref(system: "android" | "ios", url: string): string {
  if (system === "ios") return `x-safari-${url}`;
  const { protocol, host, pathname, search } = new URL(url);
  const scheme = protocol.replace(":", "");
  return `intent://${host}${pathname}${search}#Intent;scheme=${scheme};action=android.intent.action.VIEW;S.browser_fallback_url=${encodeURIComponent(url)};end`;
}
