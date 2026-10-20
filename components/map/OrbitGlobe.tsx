"use client";

import { useEffect, useId, useRef } from "react";

import {
  HULL,
  landDots,
  LINK_DEG,
  linkAngle,
  project,
  projectDot,
  SERVICE_POINT,
  spinAt,
  STILL_SPIN,
  viewAt,
} from "@/lib/globe";

import styles from "./OrbitGlobe.module.css";

/** A slow turn needs few pictures: fifteen a second is smooth at this size and light on a phone. */
const FRAME_MS = 66;

// Where things sit, as shares of the globe's diameter G; the box is 1.75 G wide and G tall.
const BOX_W = 1.75;
const GLOBE_X = 1.25;
const GLOBE_R = 0.44;
// The dish's feed, where the beam ends: (29, 21) in the craft's 40 x 28 drawing, which is drawn
// 0.95 G wide from the box's top-left corner, 0.02 G down.
const FEED = { x: (29 / 40) * 0.95, y: 0.02 + (21 / 28) * 0.95 * (28 / 40) };

const TEAL = "127 209 201"; // --jaga-teal-light; a canvas cannot read a CSS variable

/**
 * The head of the map console: a small Earth turning slowly, with a satellite in silver and
 * Jaga's teal floating at its shoulder. When Jaga's own part of the world comes round under it, the place
 * glows and data runs up the beam to the dish (the owner, 20 Oct 2026, after the Airbus
 * MilSatCom picture; it replaces the strip of 19 Oct, which took the whole width of the head).
 *
 * Decoration that says nothing: no figures, no times, no names (safety rule 8), hidden from
 * screen readers and from the pointer. The land is drawn as dots in a true orthographic view, so
 * it is a canvas redrawn fifteen times a second - and only while it is on screen and the tab is
 * open. Asked for less motion, it holds one picture: the service area under the satellite, the
 * link lit.
 */
export function OrbitGlobe() {
  const root = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const id = useId();
  const hull = `${id}-hull`;

  useEffect(() => {
    const box = root.current;
    const cv = canvas.current;
    const ctx = cv?.getContext("2d");
    if (!box || !cv || !ctx) return;

    const dots = landDots();
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const born = performance.now();
    let size = 0; // G in CSS pixels
    let frame = 0;
    let last = -Infinity;
    let onScreen = true;
    let linked = "";

    const draw = (spin: number, now: number) => {
      if (!size) return;
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size * BOX_W, size);
      const cx = size * GLOBE_X;
      const cy = size / 2;
      const r = size * GLOBE_R;

      // The air around it.
      const air = ctx.createRadialGradient(cx, cy, r * 0.92, cx, cy, r * 1.2);
      air.addColorStop(0, `rgb(${TEAL} / 0.38)`);
      air.addColorStop(1, `rgb(${TEAL} / 0)`);
      ctx.fillStyle = air;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 1.2, 0, Math.PI * 2);
      ctx.fill();

      // The night-side sphere, lit from the upper left.
      const sea = ctx.createRadialGradient(cx - r * 0.38, cy - r * 0.42, 0, cx, cy, r * 1.25);
      sea.addColorStop(0, "#1d4f6b");
      sea.addColorStop(0.55, "#0b2232");
      sea.addColorStop(1, "#040d14");
      ctx.fillStyle = sea;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();

      // The land, as dots: bright facing the reader, fading to the limb.
      const view = viewAt(spin);
      const s = Math.max(0.5, r * 0.03);
      for (const d of dots) {
        const p = projectDot(d, view);
        if (p.z <= 0) continue;
        ctx.fillStyle = `rgb(${TEAL} / ${(0.18 + 0.82 * Math.pow(p.z, 0.8)).toFixed(2)})`;
        ctx.fillRect(cx + p.x * r - s, cy - p.y * r - s, s * 2, s * 2);
      }

      ctx.strokeStyle = `rgb(${TEAL} / 0.55)`;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();

      // The service area, and the downlink while it is under the satellite. It eases in and out
      // over the last few degrees rather than switching.
      const here = project(SERVICE_POINT.lat, SERVICE_POINT.lon, spin);
      const strength = here.z > 0 ? Math.max(0, Math.min(1, (LINK_DEG - linkAngle(spin)) / 8)) : 0;
      const state = strength > 0 ? "on" : "off";
      if (state !== linked) box.dataset.link = linked = state;
      if (strength === 0) return;

      const px = cx + here.x * r;
      const py = cy - here.y * r;
      const fx = size * FEED.x;
      const fy = size * FEED.y;

      const beam = ctx.createLinearGradient(px, py, fx, fy);
      beam.addColorStop(0, `rgb(${TEAL} / ${(0.8 * strength).toFixed(2)})`);
      beam.addColorStop(1, `rgb(${TEAL} / ${(0.2 * strength).toFixed(2)})`);
      ctx.strokeStyle = beam;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(fx, fy);
      ctx.stroke();

      // Data going up: three packets from the ground to the dish.
      for (let i = 0; i < 3; i++) {
        const t = (now / 1100 + i / 3) % 1;
        ctx.fillStyle = `rgb(233 251 248 / ${(Math.sin(Math.PI * t) * strength).toFixed(2)})`;
        ctx.beginPath();
        ctx.arc(
          px + (fx - px) * t,
          py + (fy - py) * t,
          Math.max(0.6, size * 0.022),
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }

      const glow = ctx.createRadialGradient(px, py, 0, px, py, size * 0.09);
      glow.addColorStop(0, `rgb(169 227 220 / ${(0.95 * strength).toFixed(2)})`);
      glow.addColorStop(1, "rgb(169 227 220 / 0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(px, py, size * 0.09, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgb(233 251 248 / ${strength.toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(px, py, Math.max(0.7, size * 0.025), 0, Math.PI * 2);
      ctx.fill();
    };

    const paintStill = () => draw(STILL_SPIN, 0);

    const step = (now: number) => {
      frame = requestAnimationFrame(step);
      if (now - last < FRAME_MS) return;
      last = now;
      draw(spinAt(now - born), now);
    };
    const run = () => {
      const go = !still && onScreen && !document.hidden;
      box.dataset.spinning = go ? "on" : "off";
      cancelAnimationFrame(frame);
      if (go) frame = requestAnimationFrame(step);
    };

    const resize = () => {
      const g = box.getBoundingClientRect().height;
      if (!g) return;
      size = g;
      const dpr = window.devicePixelRatio || 1;
      cv.width = Math.round(g * BOX_W * dpr);
      cv.height = Math.round(g * dpr);
      if (still) paintStill();
      else draw(spinAt(performance.now() - born), performance.now());
    };

    const sized = new ResizeObserver(resize);
    sized.observe(box);
    const seen = new IntersectionObserver(([entry]) => {
      onScreen = entry?.isIntersecting ?? true;
      run();
    });
    seen.observe(box);
    document.addEventListener("visibilitychange", run);
    resize();
    run();

    return () => {
      cancelAnimationFrame(frame);
      sized.disconnect();
      seen.disconnect();
      document.removeEventListener("visibilitychange", run);
    };
  }, []);

  return (
    <div
      ref={root}
      className={styles.orbit}
      data-orbit-globe="true"
      data-spinning="off"
      data-link="off"
      aria-hidden="true"
    >
      <canvas ref={canvas} className={styles.canvas} />
      <svg className={styles.craft} viewBox="0 0 40 28">
        <defs>
          <linearGradient id={hull} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={HULL[0]} />
            <stop offset="45%" stopColor={HULL[1]} />
            <stop offset="100%" stopColor={HULL[2]} />
          </linearGradient>
        </defs>
        <g transform="rotate(-24 20 13)">
          <g className={styles.wing}>
            <rect x="0.5" y="10.5" width="12.5" height="5" rx="0.4" />
            <path d="M3.6 10.5v5M6.75 10.5v5M9.9 10.5v5M0.5 13h12.5" />
            <rect x="27" y="10.5" width="12.5" height="5" rx="0.4" />
            <path d="M30.1 10.5v5M33.25 10.5v5M36.4 10.5v5M27 13h12.5" />
          </g>
          <path className={styles.strut} d="M13 13h2M25 13h2M20 7.5V5" />
          <rect
            className={styles.body}
            x="15"
            y="7.5"
            width="10"
            height="11"
            rx="0.8"
            fill={`url(#${hull})`}
          />
          {/* A lit face and a shaded one, the panel seams, and a teal band round the hull. */}
          <path className={styles.lit} d="M15.8 8.3h4.2v3.4h-4.2z" />
          <path className={styles.shade} d="M20 13.4h4.2v4.3H20z" />
          <rect className={styles.band} x="15" y="12" width="10" height="1.4" />
          <path className={styles.seam} d="M20 7.5v11M15 15.6h10" />
          <circle className={styles.beacon} cx="20" cy="4.4" r="0.9" />
        </g>
        {/* The dish that takes the downlink, turned towards the globe. */}
        <path className={styles.strut} d="M26.2 15.6 28 19.2" />
        <path
          className={styles.dish}
          d="M26.2 19.4a3.6 3.6 0 0 0 5.4 3.4z"
          fill={`url(#${hull})`}
        />
      </svg>
    </div>
  );
}
