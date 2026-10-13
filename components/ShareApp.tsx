"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { CheckIcon, ShareIcon } from "@/components/icons";
import { sharePath } from "@/lib/site";
import { buttonSecondary, card, hint, input } from "@/lib/ui";

type State = "idle" | "copied" | "manual";

/**
 * What the button does, decided by what the browser offers. Kept apart from the component so the
 * three outcomes can be tested without a phone:
 *  - the phone's own share sheet (copy, LINE, WhatsApp, Messenger...), where there is one;
 *  - else the link is copied;
 *  - else the link is shown to copy by hand.
 * Closing the share sheet without choosing is not a failure and changes nothing.
 */
export async function shareLink(
  link: { title: string; text: string; url: string },
  browser: {
    share?: (data: { title: string; text: string; url: string }) => Promise<void>;
    copy?: (text: string) => Promise<void>;
  },
): Promise<"shared" | "dismissed" | "copied" | "manual"> {
  if (browser.share) {
    try {
      await browser.share(link);
      return "shared";
    } catch (error) {
      if ((error as { name?: string }).name === "AbortError") return "dismissed";
      // The sheet could not open at all (some in-app browsers): fall through to copying.
    }
  }
  if (browser.copy) {
    try {
      await browser.copy(link.url);
      return "copied";
    } catch {
      // No permission to write to the clipboard: show the link instead.
    }
  }
  return "manual";
}

/**
 * "Share Jaga with family and friends" (the owner, 13 Oct). One button that opens the phone's
 * own share sheet, exactly as sharing any page from the browser does, so people send the link
 * through whatever chat app they already use. Nothing is sent to Jaga and nobody is counted.
 *
 * The link is the home page in the reader's language, never the page they happen to be on: a
 * link to someone's own SOS case or account must not be what gets passed around.
 */
export function ShareApp() {
  const t = useTranslations("install.share");
  const locale = useLocale();
  const [state, setState] = useState<State>("idle");
  const [url, setUrl] = useState("");

  async function share() {
    const link = new URL(sharePath(locale), window.location.origin).toString();
    setUrl(link);
    const nav = navigator as Navigator & {
      share?: (data: { title: string; text: string; url: string }) => Promise<void>;
    };
    const outcome = await shareLink(
      { title: t("title"), text: t("text"), url: link },
      {
        share: typeof nav.share === "function" ? (data) => nav.share!(data) : undefined,
        copy: nav.clipboard?.writeText ? (text) => nav.clipboard.writeText(text) : undefined,
      },
    );
    if (outcome === "copied") setState("copied");
    else if (outcome === "manual") setState("manual");
    else setState("idle");
  }

  return (
    <section className={card} data-share-app={state}>
      <h2 className="text-body font-bold">{t("heading")}</h2>
      <p className={hint}>{t("body")}</p>
      <button type="button" onClick={share} className={`${buttonSecondary} gap-2`}>
        <ShareIcon size={22} />
        {t("button")}
      </button>
      {state === "copied" && (
        <p role="status" className="flex items-center gap-2 font-medium">
          <CheckIcon size={20} />
          {t("copied")}
        </p>
      )}
      {state === "manual" && (
        <label className="flex flex-col gap-1">
          <span className={hint}>{t("manual")}</span>
          <input
            readOnly
            value={url}
            onFocus={(event) => event.currentTarget.select()}
            className={input}
          />
        </label>
      )}
    </section>
  );
}
