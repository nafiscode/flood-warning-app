"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { CameraIcon, CrossIcon, ForwardIcon } from "@/components/icons";
import { CCTV_SOURCES, type CctvSourceId } from "@/lib/cctv";
import { buttonPrimary, buttonQuiet, hint } from "@/lib/ui";

/**
 * A closable in-app window onto an agency's own live flood cameras (owner, 22 Nov 2026: "it should
 * not leave our app, it should show as window open to cctv from their official portal but also
 * closable").
 *
 * The window itself stays inside Jaga: it opens over the page and closes on Escape, on the close
 * button, or on a tap outside it. What it holds depends on the source (lib/cctv.ts). A page that
 * permits framing is shown in an iframe; the real camera network (DDPM) forbids framing, so the
 * window instead carries one button that opens the agency's own site in a new window - the only
 * way to reach cameras a government site will not let another app embed.
 *
 * It says plainly what the pictures are and are not: the agency's own cameras, which may lag, freeze
 * on an old frame or be offline, so the viewer must read the time on the agency's page; never a Jaga
 * alert, and never a reason not to act (safety rules 2, 8 and 10). It needs a connection, so it
 * cannot work offline (safety rule 7 keeps the offline shell to the things that save a life).
 */
export function CameraWindow({ source }: { source: CctvSourceId }) {
  const t = useTranslations("cctv");
  const src = CCTV_SOURCES[source];
  const sourceName = t(src.nameKey);
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    panel.current?.focus();
    // Hold the page still behind the window, and give it back whatever it was on close.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, close]);

  return (
    <>
      <button
        type="button"
        className={`${buttonQuiet} self-start`}
        onClick={() => setOpen(true)}
        data-cctv-open={source}
      >
        <CameraIcon size={20} aria-hidden="true" />
        {t("open")}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-jaga-ink/50 sm:items-center sm:p-4"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) close();
          }}
          data-cctv-window={source}
        >
          <div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            className="flex max-h-[85vh] w-full max-w-2xl flex-col gap-3 overflow-y-auto rounded-t-2xl bg-jaga-surface p-5 outline-none sm:rounded-2xl"
          >
            <div className="flex items-start justify-between gap-3">
              <p id={titleId} className="text-h3 font-bold text-jaga-ink">
                {t("title")}
              </p>
              <button
                type="button"
                className="inline-flex size-12 shrink-0 items-center justify-center rounded-xl text-jaga-text-2 hover:bg-jaga-ground active:translate-y-px"
                onClick={close}
                aria-label={t("close")}
                data-cctv-close
              >
                <CrossIcon size={24} aria-hidden="true" />
              </button>
            </div>

            {/* What the pictures are, before the viewer looks at any (safety rules 8 and 10). */}
            <p className={hint}>{t("freshness")}</p>

            {src.embeddable ? (
              <iframe
                src={src.url}
                title={sourceName}
                loading="lazy"
                referrerPolicy="no-referrer"
                sandbox="allow-scripts allow-same-origin"
                className="aspect-video w-full rounded-xl border border-jaga-line bg-jaga-ground"
              />
            ) : (
              <a
                href={src.url}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonPrimary}
                data-cctv-launch
              >
                <ForwardIcon size={20} aria-hidden="true" />
                {t("launch", { source: sourceName })}
              </a>
            )}

            <p className={hint}>{t("offline")}</p>
            <p className={hint}>{t("emergency")}</p>
          </div>
        </div>
      )}
    </>
  );
}
