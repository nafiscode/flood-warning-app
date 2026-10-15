/**
 * "What Jaga can do" (A17, the owner's request of 15 Oct): for each kind of person, what Jaga
 * lets them do and where to find it. Pure data, so a test can hold every link to a page that
 * exists and every line to a word in all three languages.
 *
 * Each role has a few headline capabilities (a drawn picture of the real screen, one line, where
 * it is, a button) and, for residents, a short "also" list without pictures. Kept short on
 * purpose: the page is a map of the app, not its manual.
 */

export const CAPABILITY_ROLES = ["resident", "team", "supplies", "admin"] as const;
export type CapabilityRole = (typeof CAPABILITY_ROLES)[number];

/** The drawn screens in components/capabilities/Scene.tsx. */
export const SCENES = [
  "alert",
  "map",
  "sos",
  "supplies",
  "places",
  "watch",
  "register",
  "offer",
  "eta",
  "finish",
  "field",
  "coverage",
  "suppliesBoard",
  "escalate",
  "console",
  "signals",
  "autoAlarm",
  "warRoom",
  "verify",
  "dam",
] as const;
export type Scene = (typeof SCENES)[number];

/** The icon beside each line (components/icons). */
export type CapabilityIcon =
  | "alert"
  | "map"
  | "sos"
  | "parcel"
  | "house"
  | "pin"
  | "add"
  | "bell"
  | "clock"
  | "camera"
  | "list"
  | "shield"
  | "wave"
  | "megaphone"
  | "trophy"
  | "drop"
  | "cloud";

export type Capability = {
  /** Message key under `capabilities.items.<key>`: title, text, where. */
  key: string;
  icon: CapabilityIcon;
  scene: Scene;
  /** A route of the app (no locale), optionally with a query. */
  href: string;
};

export type Extra = { key: string; icon: CapabilityIcon; href: string };

export const CAPABILITIES: Record<CapabilityRole, Capability[]> = {
  resident: [
    { key: "alert", icon: "alert", scene: "alert", href: "/" },
    { key: "map", icon: "map", scene: "map", href: "/map" },
    { key: "sos", icon: "sos", scene: "sos", href: "/sos" },
    { key: "supplies", icon: "parcel", scene: "supplies", href: "/supplies" },
    { key: "places", icon: "house", scene: "places", href: "/map?focus=places" },
    { key: "watch", icon: "pin", scene: "watch", href: "/account/places" },
  ],
  team: [
    { key: "register", icon: "add", scene: "register", href: "/authority/register" },
    { key: "offer", icon: "bell", scene: "offer", href: "/authority" },
    { key: "eta", icon: "clock", scene: "eta", href: "/authority" },
    { key: "finish", icon: "camera", scene: "finish", href: "/authority" },
    { key: "field", icon: "list", scene: "field", href: "/authority/field-rescue" },
    { key: "coverage", icon: "trophy", scene: "coverage", href: "/authority" },
  ],
  supplies: [
    { key: "suppliesRegister", icon: "add", scene: "register", href: "/authority/register" },
    { key: "suppliesBoard", icon: "parcel", scene: "suppliesBoard", href: "/authority" },
    { key: "escalate", icon: "sos", scene: "escalate", href: "/authority" },
  ],
  admin: [
    { key: "console", icon: "megaphone", scene: "console", href: "/admin/alerts" },
    { key: "signals", icon: "wave", scene: "signals", href: "/admin/signals" },
    { key: "autoAlarm", icon: "bell", scene: "autoAlarm", href: "/admin/alerts" },
    { key: "warRoom", icon: "list", scene: "warRoom", href: "/admin/war-room" },
    { key: "verify", icon: "shield", scene: "verify", href: "/admin/authorities" },
    { key: "dam", icon: "drop", scene: "dam", href: "/admin/dam-release" },
  ],
};

/** The smaller things a resident can also do, as plain lines without a picture. */
export const RESIDENT_EXTRAS: Extra[] = [
  { key: "report", icon: "wave", href: "/report" },
  { key: "notify", icon: "bell", href: "/account" },
  { key: "requests", icon: "list", href: "/requests" },
  { key: "weather", icon: "cloud", href: "/weather" },
];

/**
 * Hazards Jaga will cover later: placeholders only (safety rule 10), each with the hotline to call
 * instead. The names are the SOS form's own (`sos.hazards.*`).
 */
export const COMING_HAZARDS = [
  { key: "flash_flood", hotline: "1784" },
  { key: "landslide", hotline: "1784" },
  { key: "fire", hotline: "199" },
  { key: "earthquake", hotline: "1784" },
] as const;

/** The role a link such as /features#team opens on; anything else opens on residents. */
export function roleFromHash(hash: string): CapabilityRole {
  const name = hash.replace(/^#/, "");
  return CAPABILITY_ROLES.find((r) => r === name) ?? "resident";
}

/** The path part of an href, for checking it against the app's pages. */
export function pathOf(href: string): string {
  return href.split(/[?#]/)[0] || "/";
}
