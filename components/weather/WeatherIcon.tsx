import {
  CloudIcon,
  CloudSunIcon,
  DrizzleIcon,
  FogIcon,
  HeavyRainIcon,
  MoonIcon,
  RainIcon,
  SnowIcon,
  SunIcon,
  ThunderIcon,
} from "@/components/icons";
import type { WeatherGroup } from "@/lib/weather";

type Props = { group: WeatherGroup; isDay?: boolean; size?: number; className?: string };

/** One drawing per condition, by day and by night where it makes a difference. */
const SHAPES = {
  clear: { day: SunIcon, night: MoonIcon },
  mainlyClear: { day: CloudSunIcon, night: CloudSunIcon },
  partlyCloudy: { day: CloudSunIcon, night: CloudSunIcon },
  overcast: { day: CloudIcon, night: CloudIcon },
  fog: { day: FogIcon, night: FogIcon },
  drizzle: { day: DrizzleIcon, night: DrizzleIcon },
  rainLight: { day: DrizzleIcon, night: DrizzleIcon },
  rain: { day: RainIcon, night: RainIcon },
  rainHeavy: { day: HeavyRainIcon, night: HeavyRainIcon },
  showers: { day: RainIcon, night: RainIcon },
  showersHeavy: { day: HeavyRainIcon, night: HeavyRainIcon },
  snow: { day: SnowIcon, night: SnowIcon },
  thunder: { day: ThunderIcon, night: ThunderIcon },
  thunderHail: { day: ThunderIcon, night: ThunderIcon },
} as const satisfies Record<WeatherGroup, { day: unknown; night: unknown }>;

/**
 * The picture for a weather condition. It never stands alone: the condition is always written
 * out beside it, or in the label of the link it sits in (CLAUDE.md, accessibility).
 */
export function WeatherIcon({ group, isDay = true, size = 24, className }: Props) {
  const Shape = SHAPES[group][isDay ? "day" : "night"];
  return <Shape size={size} className={className} />;
}
