"use client";

/**
 * Bring something that has just opened into the frame, and keep it there while it settles.
 *
 * Written for the map's selected-card (the owner, 14 Oct 2026: a reservoir's button sits a long
 * way down the legend on a laptop, and opening its card off the top of the screen looked as if
 * nothing had happened), and reused by the live monitoring's detail (the owner, 17 Oct: the
 * button "should also bring user to see the detail section when clicked") - where the band opens
 * under the whole dashboard and would otherwise be below the fold on every screen.
 *
 * Three things here were each learnt from something that went wrong, so none of them is spare:
 *
 *   * **The header is frozen and taller than the page's scroll padding** (155 px against 112 px
 *     on a phone), so `scrollIntoView` alone slides the first lines of a card underneath it. The
 *     header's own height is measured, and the floating row of chips with it.
 *   * **On the console a card can live in a rail that scrolls by itself**, where moving the
 *     window does nothing at all. The rail is scrolled instead. Below that breakpoint the same
 *     wrapper is `display: contents` and has no scrolling, which is what the check asks it.
 *   * **It settles as it fills.** Charts, drawings and anything still loading above it all change
 *     where it sits, so it is put back for a couple of seconds without another animation - once
 *     at 700 ms was not enough (CI, 15 Oct). The person's own scroll, touch or key ends that at
 *     once, because fighting a reader for the scroll position is worse than a card out of view.
 */
export type RevealOptions = {
  /** Marks the element for the brief highlight in app/globals.css. Default true. */
  mark?: boolean;
  /** Gives it the keyboard. Default true. */
  focus?: boolean;
};

const NUDGE_EVENTS = ["wheel", "touchstart", "keydown"] as const;

/**
 * Give the keyboard back to the control that opened something, now that it has closed.
 *
 * Closing from inside the panel takes the button that was focused out of the page with it, which
 * would drop a keyboard reader to the top of the document. The same control is often drawn twice
 * (the monitoring's way in is both a card and a console readout, one of them hidden by CSS at any
 * width), so the first one actually on the screen is the one that gets it.
 */
export function handBack(selector: string): void {
  for (const el of document.querySelectorAll<HTMLElement>(selector)) {
    if (el.offsetParent !== null) {
      el.focus({ preventScroll: true });
      return;
    }
  }
}

export function reveal(find: () => HTMLElement | null, options: RevealOptions = {}): void {
  const { mark = true, focus = true } = options;
  const reduce = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  const bring = (behavior: ScrollBehavior): HTMLElement | null => {
    const target = find();
    if (!target) return null;
    const rail = target.closest<HTMLElement>("[data-console-rail]");
    if (rail && window.getComputedStyle(rail).overflowY === "auto") {
      const off = target.getBoundingClientRect().top - rail.getBoundingClientRect().top - 12;
      if (Math.abs(off) > 4) {
        rail.scrollTo({ top: Math.max(0, rail.scrollTop + off), behavior });
      }
      return target;
    }
    const header =
      (document.querySelector("header")?.getBoundingClientRect().height ?? 0) +
      (document.querySelector("[data-map-chips-float]")?.getBoundingClientRect().height ?? 0);
    const gap = target.getBoundingClientRect().top - header - 12;
    if (Math.abs(gap) > 4) window.scrollTo({ top: Math.max(0, window.scrollY + gap), behavior });
    return target;
  };

  window.setTimeout(() => {
    const target = bring(reduce() ? "auto" : "smooth");
    if (!target) return;
    if (focus) target.focus({ preventScroll: true });
    if (mark) target.dataset.justOpened = "true";

    let hold = 0;
    const stop = () => {
      window.clearInterval(hold);
      for (const kind of NUDGE_EVENTS) window.removeEventListener(kind, stop);
    };
    window.setTimeout(() => {
      bring("auto");
      hold = window.setInterval(() => bring("auto"), 150);
      window.setTimeout(stop, 2500);
    }, 700);
    for (const kind of NUDGE_EVENTS) window.addEventListener(kind, stop, { passive: true });
    if (mark) {
      window.setTimeout(() => {
        delete target.dataset.justOpened;
      }, 1800);
    }
  }, 60);
}
