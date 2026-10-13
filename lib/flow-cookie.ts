/**
 * A sign-in started in Jaga on the home screen (owner, 2026-10-13). The LINE app cannot return
 * to an installed web app; it opens the phone's browser instead. The app therefore remembers
 * the flow it started in a short-lived cookie, and collects the sign-in itself when the person
 * comes back to it (components/SignInFinisher.tsx, app/api/auth/finish).
 *
 * This file imports nothing, so the browser's side can use it too.
 */
export const FLOW_COOKIE = "jaga-flow";
export const FLOW_NEXT_COOKIE = "jaga-flow-next";
/** As long as the database keeps a started sign-in. */
export const FLOW_COOKIE_SECONDS = 600;

/** True in Jaga opened from the home screen, on a phone, tablet or laptop. */
export function runsAsApp(win: {
  matchMedia?: (query: string) => { matches: boolean };
  /** `navigator.standalone` is Safari's own, and not in the standard types. */
  navigator?: object;
}): boolean {
  if ((win.navigator as { standalone?: boolean } | undefined)?.standalone === true) return true;
  return ["standalone", "fullscreen", "minimal-ui"].some(
    (mode) => win.matchMedia?.(`(display-mode: ${mode})`).matches === true,
  );
}

/** The link that starts a LINE sign-in, marked when it is tapped inside the installed app. */
export function lineHrefFor(href: string, asApp: boolean): string {
  if (!asApp || /[?&]app=1(&|$)/.test(href)) return href;
  return `${href}${href.includes("?") ? "&" : "?"}app=1`;
}

/** Screens where nothing may pull the person away: a request for help being written. */
const BUSY = /^\/(?:(?:th|ms|en)\/)?(?:sos|report|supplies)(?:\/|$)/;

/** Whether the app should ask now for a sign-in that may be waiting for it. */
export function shouldAskForSignIn(cookie: string, pathname: string, visible: boolean): boolean {
  if (!visible || BUSY.test(pathname)) return false;
  return cookie.split(";").some((part) => part.trim().startsWith(`${FLOW_COOKIE}=`));
}
