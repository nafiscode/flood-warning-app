import type { ReactNode } from "react";
import { BlocksIcon, CapIcon, DropIcon, PlaneIcon, SatelliteIcon } from "@/components/icons";
import type { AboutIcon } from "@/lib/about";

/** The icon beside each step on the way to Jaga, and each industry on the journey. */
export const ABOUT_ICONS: Record<AboutIcon, (size: number) => ReactNode> = {
  cap: (n) => <CapIcon size={n} />,
  drop: (n) => <DropIcon size={n} />,
  satellite: (n) => <SatelliteIcon size={n} />,
  build: (n) => <BlocksIcon size={n} />,
  plane: (n) => <PlaneIcon size={n} />,
};
