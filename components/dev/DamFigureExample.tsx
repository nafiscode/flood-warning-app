"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  DamDialFigure,
  DamRiverFigure,
  DamSectionFigure,
  type DamFigureName,
} from "@/components/dam/DamFigures";
import {
  DAM_SCENARIOS,
  exampleDamDaily,
  exampleDamDays,
  exampleDamSignal,
} from "@/lib/dev-examples";
import type { Dam } from "@/lib/dam";
import { RECORD_OUTFLOW_CMS } from "@/lib/dam-figure";
import { card, hint } from "@/lib/ui";

/**
 * The three figures side by side, in every state the dam can be in, for the owner to choose one
 * (12 Oct). Nothing here is wired into the home screen yet: this page is the choosing.
 *
 * The geometry is not needed - a figure draws the dam's *figures*, not its river - so the page
 * works without the map or the network, and every number on it is the archive's own.
 */

const DAM: Dam = {
  code: "bang_lang",
  name: { th: "เขื่อนบางลาง", en: "Bang Lang Dam" },
  river: { th: "แม่น้ำปัตตานี", en: "Pattani River" },
  operator: "EGAT",
  feed: "hourly" as const,
  point: null,
  spillwayPoint: null,
  outletPoint: null,
  reservoir: null,
  storageMaxMcm: 1589.8,
  storageNormalMcm: 1454.4,
  geometrySource: "osm",
  geometryNote: {},
  reaches: [],
  tambons: [],
  signal: null,
  daily: null,
  days: [],
  arrivals: [],
};

const FIGURES: { name: DamFigureName; draw: (props: { dam: Dam }) => React.JSX.Element }[] = [
  { name: "section", draw: DamSectionFigure },
  { name: "river", draw: DamRiverFigure },
  { name: "dial", draw: DamDialFigure },
];

export function DamFigureExample() {
  const t = useTranslations("dam");
  const tDev = useTranslations("devHome");
  const [scenario, setScenario] = useState<(typeof DAM_SCENARIOS)[number]>("releasing");
  const dam: Dam = {
    ...DAM,
    signal: exampleDamSignal(scenario),
    daily: exampleDamDaily(scenario),
    days: exampleDamDays(scenario),
    arrivals: [],
  };

  return (
    <div className="flex flex-col gap-4">
      <div role="group" aria-label={tDev("damScenarioLabel")} className="flex flex-wrap gap-2">
        {DAM_SCENARIOS.map((name) => (
          <button
            key={name}
            type="button"
            aria-pressed={scenario === name}
            data-dam-scenario={name}
            onClick={() => setScenario(name)}
            className={`inline-flex min-h-tap items-center rounded-full border-2 px-4 py-1 font-medium ${
              scenario === name
                ? "border-jaga-edge bg-jaga-slate text-white"
                : "border-jaga-edge bg-jaga-surface text-jaga-ink"
            }`}
          >
            {tDev(`damScenario.${name}`)}
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {FIGURES.map(({ name, draw: Figure }) => (
          <section key={name} className={card} data-figure-card={name}>
            <h2 className="text-h3 font-bold">{t(`figure.${name}.title`)}</h2>
            <Figure dam={dam} />
            <p className={hint}>{t(`figure.${name}.about`)}</p>
          </section>
        ))}
      </div>

      <p className={hint}>{t("figure.note")}</p>
      <p className={hint}>{t("figure.scale", { cms: RECORD_OUTFLOW_CMS })}</p>
    </div>
  );
}
