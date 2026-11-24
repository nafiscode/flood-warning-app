"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { CameraIcon, CrossIcon, ForwardIcon } from "@/components/icons";
import {
  HATYAI_CAMS,
  HATYAI_SOURCE_URL,
  hatYaiCamImage,
  hatYaiCamNameKey,
} from "@/lib/hatyai-cams";
import { buttonQuiet, hint } from "@/lib/ui";

/**
 * A closable in-app window of the live Hat Yai flood cameras (owner, 24 Nov 2026: "Build it - embed,
 * Hat Yai only"). Unlike the link-out CameraWindow, this one shows the pictures: each camera's newest
 * frame is a live JPEG from Hatyai City Climate / the Department of Water Resources (lib/hatyai-cams).
 *
 * The time is burned into every frame, so a frozen or offline camera shows an old time on its own
 * face; the window says so, and shows a camera a project runs, not a Jaga alert (safety rules 2, 8,
 * 10). Images load only while the window is open and refresh only when the viewer presses refresh, to
 * spare a community project's bandwidth; the full set and the archive are one tap away on their site.
 */
function CamFrame({ src, label }: { src: string; label: string }) {
  const t = useTranslations("hatyaiCams");
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");

  return (
    <figure className="m-0 grid gap-1">
      <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-jaga-line bg-jaga-ground">
        {/* eslint-disable-next-line @next/next/no-img-element -- a third party's live frame, never hosted or optimised by Jaga (lib/hatyai-cams) */}
        <img
          src={src}
          alt={label}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={() => setState("ok")}
          onError={() => setState("error")}
          className="size-full object-cover"
          data-cam-frame
        />
        {state === "error" && (
          <p className="absolute inset-0 grid place-items-center bg-jaga-ground p-3 text-center text-small text-jaga-text-2">
            {t("noSignal")}
          </p>
        )}
      </div>
      <figcaption className="text-small font-medium text-jaga-ink">{label}</figcaption>
    </figure>
  );
}

export function HatYaiCameras() {
  const t = useTranslations("hatyaiCams");
  const [open, setOpen] = useState(false);
  // A cache-buster so refresh pulls the newest frame; set when the window opens.
  const [bust, setBust] = useState(0);
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const close = useCallback(() => setOpen(false), []);

  const show = useCallback(() => {
    setBust(Date.now());
    setOpen(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    panel.current?.focus();
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
        onClick={show}
        data-hatyai-cams-open
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
          data-hatyai-cams-window
        >
          <div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            className="flex max-h-[88vh] w-full max-w-2xl flex-col gap-3 overflow-y-auto rounded-t-2xl bg-jaga-surface p-5 outline-none sm:rounded-2xl"
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
                data-hatyai-cams-close
              >
                <CrossIcon size={24} aria-hidden="true" />
              </button>
            </div>

            {/* What the pictures are, before the viewer reads anything into them (safety rules 8, 10). */}
            <p className={hint}>{t("freshness")}</p>

            <button
              type="button"
              className={`${buttonQuiet} self-start`}
              onClick={() => setBust(Date.now())}
              data-hatyai-cams-refresh
            >
              {t("refresh")}
            </button>

            <div className="grid gap-4">
              {HATYAI_CAMS.map((cam) => {
                const name = t(`cams.${hatYaiCamNameKey(cam.code)}`);
                return (
                  // Key on the refresh stamp too: a refresh remounts the frame, so it re-fetches the
                  // newest picture and shows its loading state again, with no setState-in-effect.
                  <CamFrame
                    key={`${cam.code}-${bust}`}
                    src={hatYaiCamImage(cam.image, bust)}
                    label={`${cam.code} · ${name}`}
                  />
                );
              })}
            </div>

            <p className={hint}>{t("credit")}</p>
            <a
              href={HATYAI_SOURCE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={`${buttonQuiet} self-start`}
              data-hatyai-cams-source
            >
              <ForwardIcon size={20} aria-hidden="true" />
              {t("source")}
            </a>

            <p className={hint}>{t("offline")}</p>
            <p className={hint}>{t("emergency")}</p>
          </div>
        </div>
      )}
    </>
  );
}
