/**
 * Jaga's own icon set (decisions, 2026-09-29). 24×24 grid, 2 px strokes, currentColor.
 * Decorative only: every icon sits next to a text label, so they are hidden from screen readers.
 * No eye icons anywhere, and no umbrella icons: the umbrella belongs to the logo (docs/brand.md).
 */
import type { SVGProps } from "react";

type IconProps = Omit<SVGProps<SVGSVGElement>, "children"> & { size?: number };

function Icon({ size = 24, children, ...rest }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

/** Normal: a check in a circle. */
export function CheckIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12.5l2.7 2.7L16.5 9" />
    </Icon>
  );
}

/** Watch: a backpack (get your go-bag ready). */
export function BackpackIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9 5V4a3 3 0 0 1 6 0v1" />
      <path d="M6 9a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v10a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2z" />
      <path d="M9 14h6v4H9z" />
      <path d="M10 9h4" />
    </Icon>
  );
}

/** Warning: a triangle with an exclamation mark. */
export function TriangleIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M10.3 3.9L2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      <path d="M12 9v4.5" />
      <path d="M12 17h.01" />
    </Icon>
  );
}

/** Evacuate: a running person. */
export function RunningPersonIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="14.5" cy="4" r="2" />
      <path d="M8 9l4-2 3 3 3.5 1" />
      <path d="M12 7l-2 6 4 3v5" />
      <path d="M10 13l-2.5 3.5L4 17" />
    </Icon>
  );
}

/** Safe to return: a house. */
export function HouseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 11l9-7 9 7" />
      <path d="M5 9.5V20h14V9.5" />
      <path d="M10 20v-5h4v5" />
    </Icon>
  );
}

/** Stale marker: a clock. */
export function ClockIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </Icon>
  );
}

/** Hotlines: a phone handset. */
export function PhoneIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2z" />
    </Icon>
  );
}

/** SOS: a lifebuoy. */
export function LifebuoyIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4" />
      <path d="M4.9 4.9l4.3 4.3M14.8 14.8l4.3 4.3M14.8 9.2l4.3-4.3M4.9 19.1l4.3-4.3" />
    </Icon>
  );
}

/** Navigate, and safe places on lists: a map pin. */
export function PinIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" />
      <circle cx="12" cy="9.5" r="2.5" />
    </Icon>
  );
}

/** Report flooding: water with waves. */
export function WaveIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 9c2-2 4-2 6 0s4 2 6 0 4-2 6 0" />
      <path d="M3 14c2-2 4-2 6 0s4 2 6 0 4-2 6 0" />
      <path d="M3 19c2-2 4-2 6 0s4 2 6 0 4-2 6 0" />
    </Icon>
  );
}

/** The map page: a folded map. */
export function MapIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z" />
      <path d="M9 4v14M15 6v14" />
    </Icon>
  );
}

/*
 * Weather icons (A-track, 9 Oct 2026). Same grid and stroke as the rest. No umbrella: that
 * belongs to the logo alone (docs/brand.md). Each one sits beside the condition in words.
 */

/** Clear sky by day: a sun. */
export function SunIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M5 5l1.8 1.8M17.2 17.2L19 19M19 5l-1.8 1.8M6.8 17.2L5 19" />
    </Icon>
  );
}

/** Clear sky at night: a crescent moon. */
export function MoonIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />
    </Icon>
  );
}

/** Mainly clear or part cloud: a cloud with the sun behind it. */
export function CloudSunIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 5V3.5M4.5 6.5L3.4 5.4M4 10H2.5M11.5 6.5l1.1-1.1" />
      <circle cx="8" cy="10" r="2.5" />
      <path d="M9 19h8a3 3 0 0 0 .3-6A4.5 4.5 0 0 0 9 13.4 2.8 2.8 0 0 0 9 19z" />
    </Icon>
  );
}

/** Cloud or overcast: a cloud. */
export function CloudIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M7 19h10a3.5 3.5 0 0 0 .4-7 5 5 0 0 0-9.6 1.6A3 3 0 0 0 7 19z" />
    </Icon>
  );
}

/** Fog or mist: a cloud over flat lines. */
export function FogIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M7 13h10a3.5 3.5 0 0 0 .4-7 5 5 0 0 0-9.6 1.6A3 3 0 0 0 7 13z" />
      <path d="M4 17h16M6 21h12" />
    </Icon>
  );
}

/** Drizzle or light rain: a cloud with two short drops. */
export function DrizzleIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M7 13h10a3.5 3.5 0 0 0 .4-7 5 5 0 0 0-9.6 1.6A3 3 0 0 0 7 13z" />
      <path d="M9.5 16.5v1.5M14.5 16.5v1.5" />
    </Icon>
  );
}

/** Rain: a cloud with falling drops. */
export function RainIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M7 13h10a3.5 3.5 0 0 0 .4-7 5 5 0 0 0-9.6 1.6A3 3 0 0 0 7 13z" />
      <path d="M8.5 16l-1 4M12 16l-1 4M15.5 16l-1 4" />
    </Icon>
  );
}

/** Heavy rain: a cloud with long drops and a line of water. */
export function HeavyRainIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M7 12h10a3.5 3.5 0 0 0 .4-7 5 5 0 0 0-9.6 1.6A3 3 0 0 0 7 12z" />
      <path d="M7.5 15l-1.5 5M11.5 15l-1.5 5M15.5 15l-1.5 5" />
      <path d="M4 21.5c2-1.5 4-1.5 6 0s4 1.5 6 0 4-1.5 6 0" />
    </Icon>
  );
}

/** Snow (only for places outside the tropics): a cloud with flakes. */
export function SnowIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M7 13h10a3.5 3.5 0 0 0 .4-7 5 5 0 0 0-9.6 1.6A3 3 0 0 0 7 13z" />
      <path d="M9 17.5h1M14 17.5h1M11.5 20.5h1" />
      <path d="M9.5 16.5v2M14.5 16.5v2M12 19.5v2" />
    </Icon>
  );
}

/** Thunderstorm: a cloud with a bolt. */
export function ThunderIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M7 13h10a3.5 3.5 0 0 0 .4-7 5 5 0 0 0-9.6 1.6A3 3 0 0 0 7 13z" />
      <path d="M13 15.5l-3 3h2.5l-1 3 3.5-4h-2.5z" />
    </Icon>
  );
}

/** Wind speed: lines blowing. */
export function WindIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 8h9a2.5 2.5 0 1 0-2.5-2.5" />
      <path d="M3 12h13a3 3 0 1 1-3 3" />
      <path d="M3 16h6" />
    </Icon>
  );
}

/** Humidity, and rain in millimetres: a drop. */
export function DropIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3.5s5.5 6 5.5 9.5a5.5 5.5 0 0 1-11 0C6.5 9.5 12 3.5 12 3.5z" />
    </Icon>
  );
}

/** Temperature: a thermometer. */
export function ThermometerIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M10 14.8V5a2 2 0 1 1 4 0v9.8a4 4 0 1 1-4 0z" />
      <path d="M12 18.5v-6" />
    </Icon>
  );
}

/** The weather map's hours play by themselves: pause them. */
export function PauseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9 5v14M15 5v14" />
    </Icon>
  );
}

/** And start them again. */
export function PlayIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M7 4.8v14.4l12-7.2z" />
    </Icon>
  );
}
