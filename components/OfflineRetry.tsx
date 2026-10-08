"use client";

import { useEffect } from "react";
import { buttonSecondary } from "@/lib/ui";

/**
 * On the offline page only: load the page again when the connection returns, and a button to try
 * now. The app used to reload on every page when the browser came back online, which would throw
 * away a half-written SOS; here there is nothing to lose and the offline text promises it.
 */
export function OfflineRetry({ label }: { label: string }) {
  useEffect(() => {
    const again = () => window.location.reload();
    window.addEventListener("online", again);
    return () => window.removeEventListener("online", again);
  }, []);
  return (
    <button type="button" onClick={() => window.location.reload()} className={buttonSecondary}>
      {label}
    </button>
  );
}
