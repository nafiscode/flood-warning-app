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

/** The bell in the header: what you missed while you were away. */
export function BellIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 9a6 6 0 0 1 12 0c0 4 1.2 5.6 2 6.5H4c.8-.9 2-2.5 2-6.5z" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </Icon>
  );
}

/** A word from the admins, which is never a hazard alert. */
export function MegaphoneIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 10v4a1 1 0 0 0 1 1h3l8 4V5l-8 4H5a1 1 0 0 0-1 1z" />
      <path d="M19 9.5a3.5 3.5 0 0 1 0 5" />
    </Icon>
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

/** A request for food, water and essentials: a parcel. */
export function ParcelIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 8l9-4 9 4v9l-9 4-9-4z" />
      <path d="M3 8l9 4 9-4M12 12v9M7.5 6l9 4" />
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

/** Install: an arrow down onto a tray. */
export function InstallIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 4v10" />
      <path d="M8 10.5l4 4 4-4" />
      <path d="M5 16v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2" />
    </Icon>
  );
}

/** The Share button as iPhones draw it: an arrow rising out of a box. */
export function ShareIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 14V3" />
      <path d="M8.5 6.5L12 3l3.5 3.5" />
      <path d="M8 10H7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-1" />
    </Icon>
  );
}

/** "Add to Home Screen" as iPhones draw it: a plus in a square. */
export function AddSquareIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="4" y="4" width="16" height="16" rx="4" />
      <path d="M12 8.5v7M8.5 12h7" />
    </Icon>
  );
}

/** A browser's menu: three dots, one above the other. */
export function MenuDotsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 5.5v.01M12 12v.01M12 18.5v.01" strokeWidth={3} />
    </Icon>
  );
}

/** Thanks to a team that did the most this month: a plain cup. In brand teal, never gold. */
export function TrophyIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 4h8v5a4 4 0 0 1-8 0z" />
      <path d="M8 5.5H5.5a2.5 2.5 0 0 0 2.6 3.4M16 5.5h2.5a2.5 2.5 0 0 1-2.6 3.4" />
      <path d="M12 13v4M8.5 20h7M10 17h4" />
    </Icon>
  );
}

/*
 * Actions (A9 low-literacy pass, 15 Oct 2026): every primary button carries an icon beside its
 * words, for readers who recognise a picture faster than a sentence.
 */

/** Find my position (GPS): a crosshair. */
export function LocateIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="2" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </Icon>
  );
}

/** Choose from a list. */
export function ListIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9 6h11M9 12h11M9 18h11" />
      <path d="M4 6h.01M4 12h.01M4 18h.01" strokeWidth={3} />
    </Icon>
  );
}

/** Send: a paper plane. */
export function SendIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M21 3L10 14" />
      <path d="M21 3l-7 18-4-7-7-4z" />
    </Icon>
  );
}

/** Add a photo: a camera. */
export function CameraIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
      <circle cx="12" cy="13" r="3.5" />
    </Icon>
  );
}

/** Record a voice note: a microphone. */
export function MicIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </Icon>
  );
}

/** Stop a recording: a square. */
export function StopIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="6" y="6" width="12" height="12" rx="1.5" />
    </Icon>
  );
}

/** Try again, refresh: a circular arrow. */
export function RetryIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M20 12a8 8 0 1 1-2.3-5.6" />
      <path d="M20 4v5h-5" />
    </Icon>
  );
}

/** Back: an arrow pointing to where the line starts (turns with the text in a right-to-left script). */
export function BackIcon(props: IconProps) {
  return (
    <Icon {...props} className={`rtl:-scale-x-100 ${props.className ?? ""}`}>
      <path d="M19 12H5M11 6l-6 6 6 6" />
    </Icon>
  );
}

/** Cancel, no: a cross. */
export function CrossIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Icon>
  );
}

/** A text message (SMS): a speech bubble. */
export function MessageIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 5h16v11H9l-5 4z" />
    </Icon>
  );
}

/** Change or manage something chosen: a pencil. */
export function EditIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 20h4L19 9l-4-4L4 16z" />
      <path d="M13 7l4 4" />
    </Icon>
  );
}

/** Onward, see more: an arrow pointing the way the text reads (it turns round in Jawi). */
export function ForwardIcon(props: IconProps) {
  return (
    <Icon {...props} className={`rtl:-scale-x-100 ${props.className ?? ""}`}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </Icon>
  );
}

/** Sign out: an arrow leaving through a door. */
export function SignOutIcon(props: IconProps) {
  return (
    <Icon {...props} className={`rtl:-scale-x-100 ${props.className ?? ""}`}>
      <path d="M10 4H5v16h5" />
      <path d="M14 8l4 4-4 4M18 12H9" />
    </Icon>
  );
}

/** Delete: a bin. */
export function TrashIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
      <path d="M10 11v5M14 11v5" />
    </Icon>
  );
}

/** The admins' pages: a shield. */
export function ShieldIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" />
    </Icon>
  );
}

/** "What Jaga can do": a question mark in a circle (the header's help button). */
export function QuestionIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.6 9.3a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.8" />
      <path d="M12 17.2h.01" />
    </Icon>
  );
}

/**
 * The map on its own, filling the screen, and the way back out of it (the owner, 18 Oct 2026):
 * four corners opening outwards, or drawn inwards to come back.
 */
export function FullScreenIcon({ exit = false, ...rest }: IconProps & { exit?: boolean }) {
  return (
    <Icon {...rest}>
      {exit ? (
        <path d="M9 3v6H3M15 3v6h6M9 21v-6H3M15 21v-6h6" />
      ) : (
        <path d="M3 9V3h6M21 9V3h-6M3 15v6h6M21 15v6h-6" />
      )}
    </Icon>
  );
}

/** Sheets stacked one on another: which map is drawn underneath everything else. */
export function LayersIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3 3 7.5l9 4.5 9-4.5L12 3Z" />
      <path d="M3 12.5 12 17l9-4.5" />
      <path d="M3 17.5 12 22l9-4.5" />
    </Icon>
  );
}

/**
 * A drawing pin, for a readout a reader wants kept open (the owner, 18 Oct 2026). Pressed in
 * when it is pinned, lying at an angle when it is not, so the state is a shape as well as a
 * colour and a word.
 */
export function TackIcon({ on = false, ...rest }: IconProps & { on?: boolean }) {
  return (
    <Icon {...rest}>
      {on ? (
        <>
          <path d="M12 17v4" />
          <path d="M8.5 3h7l-1 5 3 3v2H6.5v-2l3-3-1-5Z" />
        </>
      ) : (
        <>
          <path d="M15 20.5 12.5 18" />
          <path d="m19.5 7.5-4.9-4.9-2.5 4.4-4.2 1.3-1.4 1.4 6 6 1.4-1.4 1.3-4.2 4.3-2.6Z" />
        </>
      )}
    </Icon>
  );
}

/**
 * The side panel folded away or brought back (the owner, 18 Oct 2026): a panel at the edge of a
 * frame, with the arrow pointing the way the panel will go.
 */
export function PanelIcon({ open = true, ...rest }: IconProps & { open?: boolean }) {
  return (
    <Icon {...rest}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M15 4v16" />
      {open ? <path d="m8 9 3 3-3 3" /> : <path d="m11 9-3 3 3 3" />}
    </Icon>
  );
}

/**
 * A degree: a mortarboard over the line of a book. On "Who built Jaga" it marks the step where
 * the engineering came from, not a school badge - so it is the cap alone, with no tassel detail
 * that would turn to mush at 22 px on a cheap phone.
 */
export function CapIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2 8.5 12 4l10 4.5-10 4.5L2 8.5Z" />
      <path d="M6 10.7V16c0 1.7 2.7 3 6 3s6-1.3 6-3v-5.3" />
    </Icon>
  );
}

/**
 * An Earth-observation satellite: a body with two panels and a dish looking down. It marks the
 * THEOS-2 step, and it is the one icon on the page that says what the flood map is made of.
 */
export function SatelliteIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="9.5" y="6" width="5" height="7" rx="1" />
      <path d="M9.5 7.5h-5v4h5M14.5 7.5h5v4h-5" />
      <path d="M12 13v3" />
      <path d="M8.5 20a3.5 3.5 0 0 1 7 0Z" />
    </Icon>
  );
}

/**
 * Something built and handed over: blocks stacked into a working whole. It marks the step where
 * the owner's job became shipping systems other people depend on, which is the part of Jaga that
 * is neither hydrology nor maps.
 */
export function BlocksIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="13" width="8" height="8" rx="1.5" />
      <rect x="13" y="13" width="8" height="8" rx="1.5" />
      <rect x="8" y="3" width="8" height="8" rx="1.5" />
    </Icon>
  );
}

/**
 * An aircraft seen from above, for the aviation step of the founder's journey across industries.
 * Nose up, so the shape reads at 22 px without a runway or a tail fin to muddle it.
 */
export function PlaneIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 2.5c1 0 1.8 1.1 1.8 2.6v3.4l6.7 3.9v2.3l-6.7-2v3.7l2.3 1.7v1.7L12 19.4l-4.1 1.4v-1.7l2.3-1.7v-3.7l-6.7 2v-2.3l6.7-3.9V5.1c0-1.5.8-2.6 1.8-2.6Z" />
    </Icon>
  );
}

/** The account tab on a phone: a head over shoulders. */
export function PersonIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 20c.6-3.8 3.7-6 7.5-6s6.9 2.2 7.5 6" />
    </Icon>
  );
}

/** The menu button on a phone: three bars. */
export function MenuIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </Icon>
  );
}
