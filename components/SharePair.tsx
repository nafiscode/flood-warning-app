"use client";

import { useState } from "react";
import { shareLink } from "@/components/ShareApp";
import { CheckIcon, ShareIcon } from "@/components/icons";
import { buttonPrimary, buttonSecondary, card, hint, input } from "@/lib/ui";

type Share = { path: string; title: string; text: string; button: string };

/**
 * Two ways to pass something on, at the foot of the pages somebody reads rather than uses
 * (the owner, 20 Oct 2026): **this page**, and **Jaga**.
 *
 * The distinction is the point. `ShareApp` deliberately shares the home page wherever it is
 * pressed, because it sits on screens where the address someone happens to be at could be their
 * own SOS case or their account, and that must never be what gets passed around. These pages are
 * the opposite: they are public, identical for every visitor, and a link to one is the whole
 * reason to send it. Somebody who wants to show who built Jaga is not served by a link to the
 * home screen.
 *
 * Every word arrives as a prop. The component then needs no messages of its own, so these pages
 * send nothing to the browser but the strings they already had - no namespace, no provider, and
 * nothing added to the bundle of a page that is read on a slow phone.
 */
export function SharePair({
  heading,
  body,
  page,
  app,
  copied,
  manual,
}: {
  heading: string;
  body: string;
  page: Share;
  app: Share;
  copied: string;
  manual: string;
}) {
  const [state, setState] = useState<"idle" | "copied" | "manual">("idle");
  const [url, setUrl] = useState("");

  async function send(what: Share) {
    const link = new URL(what.path, window.location.origin).toString();
    setUrl(link);
    const nav = navigator as Navigator & {
      share?: (data: { title: string; text: string; url: string }) => Promise<void>;
    };
    const outcome = await shareLink(
      { title: what.title, text: what.text, url: link },
      {
        share: typeof nav.share === "function" ? (data) => nav.share!(data) : undefined,
        copy: nav.clipboard?.writeText ? (text) => nav.clipboard.writeText(text) : undefined,
      },
    );
    setState(outcome === "copied" ? "copied" : outcome === "manual" ? "manual" : "idle");
  }

  return (
    <section className={card} data-share-pair={state}>
      <h2 className="text-body font-bold">{heading}</h2>
      <p className={hint}>{body}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {/* This page first: it is the one the reader is on and the one they came to show. */}
        <button
          type="button"
          onClick={() => send(page)}
          data-share-this
          className={`${buttonPrimary} gap-2`}
        >
          <ShareIcon size={22} />
          {page.button}
        </button>
        <button
          type="button"
          onClick={() => send(app)}
          data-share-jaga
          className={`${buttonSecondary} gap-2`}
        >
          <ShareIcon size={22} />
          {app.button}
        </button>
      </div>
      {state === "copied" && (
        <p role="status" className="flex items-center gap-2 font-medium">
          <CheckIcon size={20} />
          {copied}
        </p>
      )}
      {state === "manual" && (
        <label className="flex flex-col gap-1">
          <span className={hint}>{manual}</span>
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
