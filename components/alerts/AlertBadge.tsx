import { useTranslations } from "next-intl";
import {
  BackpackIcon,
  CheckIcon,
  HouseIcon,
  RunningPersonIcon,
  TriangleIcon,
} from "@/components/icons";
import type { AlertLevel } from "@/lib/brand/tokens";

/** Icon per level (docs/brand.md): never color alone, always icon + label + color. */
export const LEVEL_ICON = {
  normal: CheckIcon,
  watch: BackpackIcon,
  warning: TriangleIcon,
  evacuate: RunningPersonIcon,
  return: HouseIcon,
} as const satisfies Record<AlertLevel, unknown>;

const LEVEL_CLASS: Record<AlertLevel, string> = {
  normal: "bg-alert-normal text-alert-normal-fg",
  watch: "bg-alert-watch text-alert-watch-fg",
  warning: "bg-alert-warning text-alert-warning-fg",
  evacuate: "bg-alert-evacuate text-alert-evacuate-fg",
  return: "bg-alert-return text-alert-return-fg",
};

type Props = { level: AlertLevel; size?: "md" | "hero" };

export function AlertBadge({ level, size = "md" }: Props) {
  const t = useTranslations("alert.level");
  const Icon = LEVEL_ICON[level];
  const hero = size === "hero";
  return (
    <span
      data-level={level}
      className={`inline-flex items-center gap-2 rounded-lg font-bold ${LEVEL_CLASS[level]} ${
        hero ? "min-h-16 px-5 py-2 text-hero" : "min-h-tap px-3 py-1 text-body"
      }`}
    >
      <Icon size={hero ? 40 : 24} />
      <span>{t(level)}</span>
    </span>
  );
}
