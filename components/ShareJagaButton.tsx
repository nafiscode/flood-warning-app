"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { shareLink } from "@/components/ShareApp";
import { CheckIcon, ShareIcon } from "@/components/icons";
import { sharePath } from "@/lib/site";
import { buttonSecondary, hint, input } from "@/lib/ui";

type State = "idle" | "copied" | "manual";

/**
 * Just the "Share Jaga" button, without the card around it (ShareApp is the card). It opens the
 * phone's own share sheet for the Jaga home page in the reader's language, or copies the link, or
 * shows it to copy by hand - the three outcomes of `shareLink`. Used where an announcement in the
 * bell carries the "share_app" call to action (the owner, 25 Oct 2026): a reader who is told their
 * area has no team can pass the app on in the same breath, without leaving the bell.
 */
export function ShareJagaButton() {
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
    setState(outcome === "copied" ? "copied" : outcome === "manual" ? "manual" : "idle");
  }

  return (
    <div className="flex flex-col gap-2" data-share-jaga={state}>
      <button type="button" onClick={share} className={`${buttonSecondary} gap-2 self-start`}>
        <ShareIcon size={20} />
        {t("button")}
      </button>
      {state === "copied" && (
        <p role="status" className="flex items-center gap-2 font-medium">
          <CheckIcon size={18} />
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
    </div>
  );
}
