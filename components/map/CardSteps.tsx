"use client";

import { useTranslations } from "next-intl";

/**
 * Previous and next, from inside an opened card: the same way of walking through a list the sea
 * and coast card has had since 18 Oct 2026, now for the river gauges and the reservoirs as well
 * (the owner, 20 Oct: "I want them to be able to click next to see different one as well in the
 * detail section").
 *
 * The order is the one the readout opened on (lib/map-console.ts: what is at or near its bank
 * first, then their own rivers; for reservoirs, what is doing something first). It is a total
 * order, so Next always lands on the same card and never wanders between presses.
 *
 * Both ends wrap, so neither is a dead stop, and each button names where it is about to go -
 * a button that says only "next" tells a reader nothing about whether to press it.
 */
export function CardSteps({
  items,
  currentId,
  onPick,
  label,
}: {
  /** In the order they are walked through; the names are already in the reader's language. */
  items: readonly { id: string; name: string }[];
  currentId: string;
  onPick: (id: string) => void;
  /** What this row of buttons is for, for a screen reader. */
  label: string;
}) {
  const t = useTranslations("map.steps");
  const at = items.findIndex((item) => item.id === currentId);
  if (items.length < 2 || at < 0) return null;
  return (
    <nav className="flex items-center justify-between gap-2" data-card-steps="true" aria-label={label}>
      {([-1, 1] as const).map((step) => {
        const next = items[(at + step + items.length) % items.length]!;
        return (
          <button
            key={step}
            type="button"
            data-card-step={step < 0 ? "previous" : "next"}
            onClick={() => onPick(next.id)}
            className="inline-flex min-h-tap items-center gap-1.5 rounded-xl border-2 border-jaga-line px-3 py-1 text-start font-medium hover:border-jaga-teal-ink active:translate-y-px"
          >
            {step < 0 && <span aria-hidden="true">‹</span>}
            <span className="flex flex-col leading-tight">
              <span className="text-small text-jaga-text-2">
                {t(step < 0 ? "previous" : "next")}
              </span>
              <span>{next.name}</span>
            </span>
            {step > 0 && <span aria-hidden="true">›</span>}
          </button>
        );
      })}
    </nav>
  );
}
