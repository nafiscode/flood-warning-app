"use client";

import { useEffect, useId, useRef } from "react";

import {
  BOLTS,
  canopyPath,
  dotMark,
  easeInOut,
  FULL_MARK,
  MARK_VIEWBOX,
  ray,
  REST_MS,
  SMALL_MARK,
  stemPath,
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

// Lightning is white (teal on a light background), never yellow: yellow is the Watch level (docs/brand.md).
const COLORS = {
  light: { ink: "#1D3B53", canopy: "#2F9C95", mark: "#FFFFFF", ray: "#2F9C95", bolt: "#1F7A74" },
  reverse: { ink: "#FFFFFF", canopy: "#7FD1C9", mark: "#1D3B53", ray: "#7FD1C9", bolt: "#FFFFFF" },
} as const;

/** About 30 pictures a second is plenty for a slow turn and half the work for a cheap phone. */
const FRAME_MS = 32;

/**
 * TRIAL (9 Oct 2026, owner's request). The canopy, the dot and the j turn three times together
 * about the upright of the j, the dot sending out a ray like a radar while they do; then all rest
 * as the static mark for three seconds, and it starts again. Lightning strikes the top of the canopy from the empty space above it every five seconds, in
 * three shapes (timed in app/globals.css). Nothing moves for people who ask their device for
 * reduced motion, and before the script runs, or without it, this is the static mark.
 */
export function SpinningMark({ width, height, small, tone, label }: Props) {
  const spec = small ? SMALL_MARK : FULL_MARK;
  const colors = COLORS[tone];
  const id = useId();
  const canopy = useRef<SVGPathElement>(null);
  const mark = useRef<SVGEllipseElement>(null);
  const stem = useRef<SVGPathElement>(null);
  const beam = useRef<SVGPolygonElement>(null);
  const fade = useRef<SVGLinearGradientElement>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const scallopDeg = 180 / spec.canopy.scallops; // the front half shows `scallops` of them
    const cycle = TURN_MS + REST_MS;
    const start = performance.now() + 500;
    let frame = 0;
    let timer = 0;
    let last = 0;

    const draw = (turnDeg: number, progress: number) => {
      canopy.current?.setAttribute("d", canopyPath(spec, turnDeg / scallopDeg));
      stem.current?.setAttribute("d", stemPath(spec, turnDeg));
      const m = dotMark(spec, turnDeg);
      mark.current?.setAttribute("cx", m.cx.toFixed(2));
      mark.current?.setAttribute("rx", m.rx.toFixed(2));
      const r = ray(spec, turnDeg, progress);
      beam.current?.setAttribute("opacity", r ? r.opacity.toFixed(2) : "0");
      if (r) {
        beam.current?.setAttribute("points", r.points);
        fade.current?.setAttribute("x2", r.tipX.toFixed(1));
      }
    };
    const later = (ms: number) => {
      timer = window.setTimeout(() => (frame = requestAnimationFrame(step)), ms);
    };
    const step = (now: number) => {
      const t = now - start;
      if (t < 0) return later(-t);
      const inCycle = t % cycle;
      if (inCycle >= TURN_MS) {
        draw(0, 0); // exactly the static mark, and no work until the next turn
        return later(cycle - inCycle);
      }
      if (now - last >= FRAME_MS) {
        last = now;
        const p = inCycle / TURN_MS;
        draw(360 * TURNS * easeInOut(p), p);
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => {
      window.clearTimeout(timer);
      cancelAnimationFrame(frame);
    };
  }, [spec]);

  const rest = dotMark(spec, 0);
  const { x0, x1, top } = spec.canopy;
  // The bolts strike from above the mark, so the picture may draw a little outside its own box.
  // The bolts are drawn for the small mark's canopy (x 20–100, y 4–34); the full mark's is smaller.
  const fit = small
    ? undefined
    : `translate(${x0 - (20 * (x1 - x0)) / 80} ${top - (4 * (34 - top)) / 30}) scale(${(x1 - x0) / 80} ${(34 - top) / 30})`;

  return (
    <svg
      viewBox={MARK_VIEWBOX}
      width={width}
      height={height}
      className="shrink-0 overflow-visible"
      role={label ? "img" : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
    >
      <defs>
        <clipPath id={`${id}dot`}>
          <circle cx={spec.dot.cx} cy={spec.dot.cy} r={spec.dot.r} />
        </clipPath>
        <linearGradient
          ref={fade}
          id={`${id}fade`}
          gradientUnits="userSpaceOnUse"
          x1={spec.dot.cx}
          y1="0"
          x2={spec.dot.cx + 40}
          y2="0"
        >
          <stop offset="0" stopColor={colors.ray} stopOpacity="0.85" />
          <stop offset="1" stopColor={colors.ray} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path ref={canopy} d={canopyPath(spec)} fill={colors.canopy} />
      <g transform={fit}>
        {BOLTS.map((bolt, i) => (
          <g
            key={bolt.d}
            className={`jaga-bolt jaga-bolt-${i + 1}`}
            opacity="0"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {bolt.kind === "fill" ? (
              <path d={bolt.d} fill={colors.bolt} />
            ) : (
              <path d={bolt.d} fill="none" stroke={colors.bolt} strokeWidth="3.2" />
            )}
          </g>
        ))}
      </g>
      <polygon ref={beam} points="" fill={`url(#${id}fade)`} opacity="0" />
      <circle cx={spec.dot.cx} cy={spec.dot.cy} r={spec.dot.r} fill={colors.ink} />
      <ellipse
        ref={mark}
        cx={rest.cx}
        cy={spec.dot.cy}
        rx={rest.rx}
        ry={rest.ry}
        fill={colors.mark}
        clipPath={`url(#${id}dot)`}
      />
      <path
        ref={stem}
        d={stemPath(spec)}
        fill="none"
        stroke={colors.ink}
        strokeWidth={spec.stem.width}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
