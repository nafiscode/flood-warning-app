"use client";

import { useEffect, useState } from "react";
import { isPhoneBrowser } from "@/lib/features";
import { buttonPrimary } from "@/lib/ui";

type Props = {
  /** /api/auth/line with the page's locale and return path; works without any script. */
  href: string;
  children: React.ReactNode;
};

/** Supabase's sign-in request is only valid for a few minutes, so a waiting page asks again. */
const REFRESH_MS = 2 * 60 * 1000;

/**
 * The "Sign in with LINE" button. It is always a real link. On a phone the link is swapped for
 * LINE's own address as soon as the page has loaded: some phone browsers (Chrome on iPhone) open
 * the LINE app only when the tapped link itself points at LINE, not when a redirect leads there.
 * Safari follows the redirect, and so does everything else if the swap has not happened.
 */
export function LineSignInLink({ href, children }: Props) {
  const [direct, setDirect] = useState<string | null>(null);

  useEffect(() => {
    if (!isPhoneBrowser(navigator.userAgent)) return;
    let stopped = false;
    async function prepare() {
      if (document.visibilityState !== "visible") return;
      try {
        const response = await fetch(`${href}&format=json`, { cache: "no-store" });
        const body: unknown = response.ok ? await response.json() : null;
        const url = (body as { url?: unknown } | null)?.url;
        if (!stopped) setDirect(typeof url === "string" ? url : null);
      } catch {
        if (!stopped) setDirect(null);
      }
    }
    void prepare();
    const timer = window.setInterval(prepare, REFRESH_MS);
    // Coming back to the tab, or back to the page from LINE, needs a fresh request.
    document.addEventListener("visibilitychange", prepare);
    window.addEventListener("pageshow", prepare);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", prepare);
      window.removeEventListener("pageshow", prepare);
    };
  }, [href]);

  return (
    <a href={direct ?? href} rel="nofollow" referrerPolicy="no-referrer" className={buttonPrimary}>
      {children}
    </a>
  );
}
