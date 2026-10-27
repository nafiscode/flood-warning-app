"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { usePathname } from "@/i18n/navigation";
import {
  bare,
  markSeen,
  NO_TOUR,
  placeCard,
  readSeen,
  stepKey,
  toursFor,
  type CardPlace,
  type GuideTour,
} from "@/lib/guide-tour";

// Pale and plain on purpose: the tour is a margin note, not part of Jaga's own look.
const plain =
  "inline-flex min-h-tap items-center rounded-xl border border-jaga-line bg-jaga-surface px-4 font-medium text-jaga-text active:translate-y-px";

/** A phone's width (the Tailwind `sm` line, as PhoneTabs uses): there is no tour there (the owner, 25 Oct). */
const PHONE = "(max-width: 639px)";
const onPhone = (notify: () => void) => {
  const query = window.matchMedia(PHONE);
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
};

type Open = { tour: GuideTour; steps: string[]; manual: boolean };

/** The first visible element a selector names, or null. */
function find(selector: string): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(selector)) {
    const box = el.getBoundingClientRect();
    if (box.width > 0 && box.height > 0) return el;
  }
  return null;
}

/** The ids of the steps whose element is on the page now, in the tour's order. */
function present(tour: GuideTour): string[] {
  return tour.steps.filter((s) => find(s.target)).map((s) => s.id);
}

/**
 * The guide tour (see lib/guide-tour.ts). Opens by itself once per page on a first visit, never
 * dims or blocks the page, closes on Escape, on its own button or on leaving the page, and is
 * opened again by "Show me around" at the end of the page.
 */
export function GuideTour() {
  const t = useTranslations("guide");
  const pathname = usePathname();
  const [open, setOpen] = useState<Open | null>(null);
  const [index, setIndex] = useState(0);
  const [offer, setOffer] = useState<GuideTour | null>(null);
  const [ring, setRing] = useState<DOMRect | null>(null);
  // Where the card sits (lib/guide-tour.ts placeCard): never over the thing it points at.
  const [place, setPlace] = useState<CardPlace>({ how: "top", top: 0 });
  const card = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement>(null);

  const path = bare(pathname);
  const phone = useSyncExternalStore(
    onPhone,
    () => window.matchMedia(PHONE).matches,
    () => true,
  );

  // On every page: find the tour that fits what is drawn, offer its button, and open it once.
  useEffect(() => {
    const tours = phone || NO_TOUR.test(path) ? [] : toursFor(path);
    let tries = 0;
    let counted = -1;
    // The previous page's tour is dropped first, inside the timer so the render stays pure.
    const reset = window.setTimeout(() => {
      setOpen(null);
      setOffer(null);
    }, 0);
    if (tours.length === 0) return () => window.clearTimeout(reset);
    const look = () => {
      tries += 1;
      const tour = tours.find((candidate) => present(candidate).length > 0);
      if (!tour) return tries >= 16;
      // Wait until the page has stopped filling in (two looks the same), or a step whose
      // button arrives a moment late would be left out now and shown on the next visit.
      const count = present(tour).length;
      const settled = count === counted;
      counted = count;
      if (!settled && tries < 12) return false;
      setOffer(tour);
      // Never by itself on a screen for asking help, nor while the area is in an alert (A16).
      const quiet = document.querySelector('[data-hero="alert"], [data-place-alert]');
      // By itself only the steps this device has not been shown yet: a button that was hidden
      // on earlier visits (signed out, no team yet) is new the first time it is on the page.
      const seen = readSeen();
      const fresh = present(tour).filter((id) => !seen[stepKey(tour.id, id)]);
      if (!tour.manualOnly && !quiet && fresh.length > 0) {
        setOpen({ tour, steps: fresh, manual: false });
        setIndex(0);
      }
      return true;
    };
    const timer = window.setInterval(() => {
      if (look()) window.clearInterval(timer);
    }, 500);
    return () => {
      window.clearTimeout(reset);
      window.clearInterval(timer);
    };
  }, [path, phone]);

  const close = useCallback(() => {
    setOpen((current) => {
      if (current) {
        markSeen(current.steps.map((id) => stepKey(current.tour.id, id)));
        if (current.manual) opener.current?.focus();
      }
      return null;
    });
  }, []);

  const step = open ? open.tour.steps.find((s) => s.id === open.steps[index]) : undefined;

  // Point at the step: scroll it into view and follow it while the page moves.
  useEffect(() => {
    if (!open || !step) return;
    const target = find(step.target);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target?.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
    let frame = 0;
    const place = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!target) {
          setRing(null);
          return;
        }
        const box = target.getBoundingClientRect();
        const head = document.querySelector("header")?.getBoundingClientRect().bottom ?? 0;
        const foot = document.querySelector("footer")?.getBoundingClientRect().top ?? innerHeight;
        // A target taller than the room between the header and the hotline bar is outlined
        // only where it shows, so the ring never runs over the hotlines.
        const from = Math.max(box.top, head);
        const to = Math.min(box.bottom, foot);
        setRing(to > from ? new DOMRect(box.left, from, box.width, to - from) : null);
        // The card's own size, once it has been drawn, so "does it fit beside" is a fact.
        const size = card.current;
        setPlace(
          placeCard({
            ring: to > from ? { left: box.left, top: from, right: box.right, bottom: to } : null,
            head,
            foot,
            viewport: { width: innerWidth, height: innerHeight },
            card: { width: size?.offsetWidth ?? 384, height: size?.offsetHeight ?? 260 },
          }),
        );
      });
    };
    place();
    window.addEventListener("scroll", place, { passive: true });
    window.addEventListener("resize", place);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", place);
      window.removeEventListener("resize", place);
    };
  }, [open, step]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  // A manual opening moves focus into the card; the automatic one leaves the page where it is.
  useEffect(() => {
    if (open?.manual) card.current?.focus();
  }, [open, index]);

  if (phone || !offer) return null;
  const total = open?.steps.length ?? 0;
  const last = index >= total - 1;

  return (
    <>
      <p className="mt-2 text-center" data-guide-offer="true">
        <button
          ref={opener}
          type="button"
          className="inline-flex min-h-tap items-center px-2 font-medium text-jaga-ink underline"
          onClick={() => {
            setIndex(0);
            setOpen({ tour: offer, steps: present(offer), manual: true });
          }}
        >
          {t("show")}
        </button>
      </p>
      {open && step && (
        <>
          {ring && (
            <div
              aria-hidden="true"
              data-guide-ring="true"
              className="pointer-events-none fixed z-30 rounded-xl border-2 border-dashed border-jaga-text-2 shadow-[0_0_0_2px_#fff]"
              style={{
                top: ring.top - 6,
                left: ring.left - 6,
                width: ring.width + 12,
                height: ring.height + 12,
              }}
            />
          )}
          <div
            ref={card}
            tabIndex={-1}
            role="region"
            aria-label={t("label")}
            aria-live="polite"
            data-guide-card={open.tour.id}
            data-guide-step={step.id}
            className="fixed inset-x-2 z-30 mx-auto flex max-w-sm flex-col gap-2 rounded-2xl border border-jaga-line bg-jaga-ground p-4 text-jaga-text shadow-md outline-none"
            style={
              place.how === "beside"
                ? {
                    left: place.left,
                    top: place.top,
                    right: "auto",
                    width: place.width,
                    marginInline: 0,
                  }
                : place.how === "bottom"
                  ? { bottom: place.bottom }
                  : { top: place.top }
            }
          >
            <p className="text-small text-jaga-text-2">{t("progress", { n: index + 1, total })}</p>
            <h2 className="text-body font-bold text-jaga-text">
              {t(`${open.tour.id}.${step.id}.title`)}
            </h2>
            <p>{t(`${open.tour.id}.${step.id}.body`)}</p>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button type="button" className={plain} onClick={close}>
                {t("close")}
              </button>
              <div className="flex gap-2">
                {index > 0 && (
                  <button type="button" className={plain} onClick={() => setIndex(index - 1)}>
                    {t("back")}
                  </button>
                )}
                <button
                  type="button"
                  className={`${plain} border-jaga-text-2`}
                  onClick={() => (last ? close() : setIndex(index + 1))}
                >
                  {last ? t("done") : t("next")}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
