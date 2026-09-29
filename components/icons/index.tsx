/**
 * Jaga's own icon set (decisions, 2026-09-29). 24×24 grid, 2 px strokes, currentColor.
 * Decorative only: every icon sits next to a text label, so they are hidden from screen readers.
 * No eye icons anywhere; the eye belongs to the logo (docs/brand.md).
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
