import type { ReactNode } from "react";
import { BlocksIcon, CapIcon, DropIcon, SatelliteIcon } from "@/components/icons";
import type { AboutIcon } from "@/lib/about";

/** The icon beside each step on the way to Jaga ("Who built Jaga", 20 Oct 2026). */
export const ABOUT_ICONS: Record<AboutIcon, (size: number) => ReactNode> = {
  cap: (n) => <CapIcon size={n} />,
  drop: (n) => <DropIcon size={n} />,
  satellite: (n) => <SatelliteIcon size={n} />,
  build: (n) => <BlocksIcon size={n} />,
};
