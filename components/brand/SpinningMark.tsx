"use client";

import { useEffect, useId, useRef } from "react";

import {
  canopyPath,
  dotMark,
  easeInOut,
  FULL_MARK,
  MARK_VIEWBOX,
  SMALL_MARK,
  TURN_MS,
  TURNS,
} from "@/lib/brand/mark";

type Props = {
  width: number;
  height: number;
  small: boolean;
  tone: "light" | "reverse";
  /** Accessible name; leave empty when the wordmark beside it already says "Jaga". */
  label: string;
};

const COLORS = {
  light: { ink: "#1D3B53", canopy: "#2F9C95", mark: "#FFFFFF" },
  reverse: { ink: "#FFFFFF", canopy: "#7FD1C9", mark: "#1D3B53" },
} as const;

/**
 * TRIAL (9 Oct 2026, owner's request): when a page opens, the canopy turns three times about the
 * stem and the dot turns with it, then both come to rest as the static mark. One run per page
 * load; nothing moves for people who ask their device for reduced motion. Before the script
 * runs, and without it, this is the static mark.
 */
export function SpinningMark({ width, height, small, tone, label }: Props) {
  const spec = small ? SMALL_MARK : FULL_MARK;
  const colors = COLORS[tone];
  const clip = useId();
  const canopy = useRef<SVGPathElement>(null);
  const mark = useRef<SVGEllipseElement>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const scallopDeg = 180 / spec.canopy.scallops; // the front half shows `scallops` of them
    let frame = 0;
    let start = 0;

    const draw = (turnDeg: number) => {
      canopy.current?.setAttribute("d", canopyPath(spec, turnDeg / scallopDeg));
      const m = dotMark(spec, turnDeg);
      mark.current?.setAttribute("cx", m.cx.toFixed(2));
      mark.current?.setAttribute("rx", m.rx.toFixed(2));
    };
    const step = (now: number) => {
      if (!start) start = now;
      const p = (now - start) / TURN_MS;
      if (p >= 1) return draw(0); // exactly the static mark
      draw(360 * TURNS * easeInOut(p));
      frame = requestAnimationFrame(step);
    };
    const wait = window.setTimeout(() => (frame = requestAnimationFrame(step)), 500);
    return () => {
      window.clearTimeout(wait);
      cancelAnimationFrame(frame);
    };
  }, [spec]);

  const rest = dotMark(spec, 0);
  return (
    <svg
      viewBox={MARK_VIEWBOX}
      width={width}
      height={height}
      className="shrink-0"
      role={label ? "img" : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
    >
      <clipPath id={clip}>
        <circle cx={spec.dot.cx} cy={spec.dot.cy} r={spec.dot.r} />
      </clipPath>
      <path ref={canopy} d={canopyPath(spec)} fill={colors.canopy} />
      <circle cx={spec.dot.cx} cy={spec.dot.cy} r={spec.dot.r} fill={colors.ink} />
      <ellipse
        ref={mark}
        cx={rest.cx}
        cy={spec.dot.cy}
        rx={rest.rx}
        ry={rest.ry}
        fill={colors.mark}
        clipPath={`url(#${clip})`}
      />
      <path
        d={spec.stem.d}
        fill="none"
        stroke={colors.ink}
        strokeWidth={spec.stem.width}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
