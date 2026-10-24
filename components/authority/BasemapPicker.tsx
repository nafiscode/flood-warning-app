"use client";

import { useTranslations } from "next-intl";
import { BASEMAPS, type Basemap } from "@/lib/map";

/**
 * The same four basemaps as the main map (the owner, 24 Oct 2026: "utilize basemaps from our main
 * map"): standard, terrain, satellite, satellite with terrain. The list and the switch live in
 * lib/map.ts; this is only the buttons, using the main map's own words.
 */
export function BasemapPicker({
  value,
  onPick,
  className = "flex flex-wrap gap-2",
}: {
  value: Basemap;
  onPick: (basemap: Basemap) => void;
  className?: string;
}) {
  const t = useTranslations("map");
  return (
    <div
      role="group"
      aria-label={t("basemap.title")}
      className={className}
      data-basemap-picker="true"
    >
      {BASEMAPS.map((kind) => (
        <button
          key={kind}
          type="button"
          aria-pressed={value === kind}
          data-basemap-choice={kind}
          onClick={() => onPick(kind)}
          className={`inline-flex min-h-tap items-center rounded-xl px-3 text-small font-medium ${
            value === kind
              ? "bg-jaga-slate text-white"
              : "border border-jaga-edge bg-jaga-surface text-jaga-ink"
          }`}
        >
          {t(`basemap.${kind}`)}
        </button>
      ))}
    </div>
  );
}
