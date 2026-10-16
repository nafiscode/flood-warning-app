import type { ReactNode } from "react";
import {
  BellIcon,
  CheckIcon,
  ClockIcon,
  CloudSunIcon,
  DropIcon,
  HouseIcon,
  LifebuoyIcon,
  ListIcon,
  MapIcon,
  MegaphoneIcon,
  MessageIcon,
  ParcelIcon,
  RetryIcon,
  ShieldIcon,
  ThermometerIcon,
  WaveIcon,
  WindIcon,
} from "@/components/icons";
import type { HowIcon } from "@/lib/how-it-works";

/** The icon beside each part of "How Jaga works" (A18). */
export const HOW_ICONS: Record<HowIcon, (size: number) => ReactNode> = {
  wave: (n) => <WaveIcon size={n} />,
  map: (n) => <MapIcon size={n} />,
  gauge: (n) => <ThermometerIcon size={n} />,
  bell: (n) => <BellIcon size={n} />,
  drop: (n) => <DropIcon size={n} />,
  house: (n) => <HouseIcon size={n} />,
  clock: (n) => <ClockIcon size={n} />,
  cloud: (n) => <CloudSunIcon size={n} />,
  wind: (n) => <WindIcon size={n} />,
  message: (n) => <MessageIcon size={n} />,
  list: (n) => <ListIcon size={n} />,
  shield: (n) => <ShieldIcon size={n} />,
  sos: (n) => <LifebuoyIcon size={n} />,
  megaphone: (n) => <MegaphoneIcon size={n} />,
  retry: (n) => <RetryIcon size={n} />,
  check: (n) => <CheckIcon size={n} />,
  parcel: (n) => <ParcelIcon size={n} />,
};
