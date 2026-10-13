"use client";

import { useEffect } from "react";
import { shouldAskForSignIn } from "@/lib/flow-cookie";

const EVERY_MS = 3000;
const FAILED = "/sign-in?error=link";

/**
 * Finishes, inside Jaga on the home screen, a LINE sign-in that was started there (owner,
 * 13 Oct). The LINE app hands the person back to the phone's browser, which leaves the sign-in
 * waiting; when they return to the app this asks for it and the app is signed in.
 *
 * It asks only while the cookie of a started sign-in exists (ten minutes at most), only while
 * the app is on screen, and never on the SOS, report or supplies screens: it ends by opening
 * the account page, and nothing may pull someone away from a request for help.
 */
export function SignInFinisher() {
  useEffect(() => {
    let busy = false;
    let over = false;
    const ask = async () => {
      if (busy || over) return;
      const visible = document.visibilityState === "visible";
      if (!shouldAskForSignIn(document.cookie, window.location.pathname, visible)) return;
      busy = true;
      try {
        const response = await fetch("/api/auth/finish", { method: "POST" });
        const answer = (await response.json()) as { state?: string; to?: string };
        if (answer.state === "done" && typeof answer.to === "string") {
          over = true;
          // A whole page load on purpose: the session cookies are new, and every part of the
          // page that was drawn for a visitor has to be asked for again.
          window.location.replace(answer.to);
        } else if (answer.state === "failed") {
          over = true;
          window.location.replace(FAILED);
        }
      } catch {
        // No connection just now: the next round asks again.
      } finally {
        busy = false;
      }
    };
    void ask();
    const timer = window.setInterval(ask, EVERY_MS);
    document.addEventListener("visibilitychange", ask);
    window.addEventListener("pageshow", ask);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", ask);
      window.removeEventListener("pageshow", ask);
    };
  }, []);
  return null;
}
