import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { ARCHITECTURE, creditById, WORKFLOW, WORKFLOW_STAGES } from "@/lib/how-it-works";
import s from "./How.module.css";

/**
 * The drawings on "How Jaga works" (A18). Each one is a small picture with numbered marks, and
 * the numbers answer the lines underneath: the drawing carries no words of its own, so it needs
 * no translation, never overflows at 360 px, and reads the same in Thai, Malay and English.
 *
 * All of it is drawn in the page. Nothing is downloaded, nothing moves.
 */

function Figure({
  title,
  drawing,
  steps,
  caption,
  legend,
}: {
  title: string;
  drawing: ReactNode;
  steps?: string[];
  caption?: string;
  legend?: ReactNode;
}) {
  return (
    <figure className={`flex flex-col gap-3 ${s.fig}`}>
      <h4 className="font-bold text-jaga-ink">{title}</h4>
      {drawing}
      {legend}
      {steps && (
        <ol className="flex flex-col gap-2">
          {steps.map((step, i) => (
            <li key={step} className="flex items-start gap-2 text-jaga-text">
              <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-jaga-slate text-small font-bold text-white">
                {i + 1}
              </span>
              {step}
            </li>
          ))}
        </ol>
      )}
      {caption && <figcaption className="text-small text-jaga-text-2">{caption}</figcaption>}
    </figure>
  );
}

/** The numbered mark inside a drawing. */
function Mark({ n, x, y }: { n: number; x: number; y: number }) {
  return (
    <g>
      <circle className={s.marker} cx={x} cy={y} r={8} />
      <text className={s.markerText} x={x} y={y + 3.2}>
        {n}
      </text>
    </g>
  );
}

/** One patch of flood, drawn the same in each panel so the eye can compare them. */
const FLOOD_PATCH =
  "M 26 44 C 34 36 48 34 56 40 C 64 46 72 44 78 50 C 84 56 76 62 66 62 C 54 62 44 68 34 62 C 26 57 20 50 26 44 Z";

/** Satellite radar: the same ground, twice, and what changed between the two passes. */
export function RadarFigure() {
  const t = useTranslations("howItWorks.figures.radar");
  return (
    <Figure
      title={t("title")}
      caption={t("caption")}
      steps={[t("step1"), t("step2"), t("step3")]}
      drawing={
        <svg
          className={s.frame}
          viewBox="0 0 320 128"
          role="img"
          aria-label={t("alt")}
          preserveAspectRatio="xMidYMid meet"
        >
          {/* The satellite, and the swath it looks through on both days. */}
          <g>
            <rect className={s.edge} x={142} y={8} width={14} height={9} rx={2} />
            <path className={s.edge} d="M136 12.5 h-8 M162 12.5 h8" />
            <path className={s.swath} d="M146 18 L 60 40 L 112 40 L 150 18 Z" />
            <path className={s.swath} d="M152 18 L 190 40 L 242 40 L 154 18 Z" />
          </g>

          {/* Left: the dry months of the same year, from the same orbit. Right: the flood day. */}
          <g>
            <rect className={s.land} x={14} y={40} width={132} height={74} rx={6} />
            <rect className={s.land} x={174} y={40} width={132} height={74} rx={6} />
            {/* The river, in both panels. */}
            <path
              className={s.water}
              d="M14 86 C 50 80 70 92 104 84 C 126 79 136 82 146 80 L 146 90 C 136 92 126 89 104 94 C 70 102 50 90 14 96 Z"
            />
            <path
              className={s.water}
              d="M174 86 C 210 80 230 92 264 84 C 286 79 296 82 306 80 L 306 90 C 296 92 286 89 264 94 C 230 102 210 90 174 96 Z"
            />
            {/* Water standing on the land, only on the flood day. */}
            <g transform="translate(160 14)">
              <path className={s.flood} d={FLOOD_PATCH} />
            </g>
            {/* What the two passes differ by: the patch alone, outlined. */}
            <g transform="translate(160 14)">
              <path className={s.edge} d={FLOOD_PATCH} strokeDasharray="4 3" />
            </g>
          </g>

          <Mark n={1} x={28} y={52} />
          <Mark n={2} x={188} y={52} />
          <Mark n={3} x={292} y={104} />
        </svg>
      }
    />
  );
}

/** Height above the nearest stream: why low land is marked, and why a town is marked differently. */
export function HeightFigure() {
  const t = useTranslations("howItWorks.figures.height");
  return (
    <Figure
      title={t("title")}
      caption={t("caption")}
      steps={[t("step1"), t("step2"), t("step3")]}
      legend={
        <ul className="flex flex-wrap gap-x-5 gap-y-2 text-small text-jaga-text">
          {(["high", "medium", "low", "none"] as const).map((key) => (
            <li key={key} className="flex items-center gap-2">
              <span
                className={s.swatch}
                style={{
                  background:
                    key === "none" ? "var(--jaga-surface)" : `var(--risk-${key})`,
                }}
              />
              {t(`legend.${key}`)}
            </li>
          ))}
        </ul>
      }
      drawing={
        <svg
          className={s.frame}
          viewBox="0 0 320 132"
          role="img"
          aria-label={t("alt")}
          preserveAspectRatio="xMidYMid meet"
        >
          {/* The ground, cut through: a hill on the left, the floodplain and the stream. */}
          <path
            className={s.land}
            d="M0 132 L0 44 C 26 30 48 54 74 70 C 96 84 118 96 150 98 L 196 98 C 232 96 258 86 286 92 L 320 96 L 320 132 Z"
          />
          {/* The stream the land around here drains to. */}
          <path className={s.water} d="M150 98 L 196 98 L 192 108 L 154 108 Z" />
          {/* The classes, lowest land nearest the stream. */}
          <rect className={s.high} x={140} y={92} width={66} height={6} rx={2} />
          <rect className={s.medium} x={108} y={88} width={32} height={6} rx={2} />
          <rect className={s.medium} x={206} y={90} width={44} height={6} rx={2} />
          <rect className={s.low} x={84} y={78} width={24} height={6} rx={2} />
          <rect className={s.low} x={250} y={86} width={40} height={6} rx={2} />
          {/* The height of one place above that stream: the measure behind the classes. */}
          <g>
            <path className={s.levelLine} d="M70 72 L 300 72" />
            <path className={s.edge} d="M264 72 L 264 90 M260 76 L 264 72 L 268 76 M260 86 L 264 90 L 268 86" />
          </g>
          {/* A town on the plain: the radar cannot see between the houses. */}
          <g>
            {[0, 1, 2, 3].map((i) => (
              <rect
                key={i}
                className={s.edge}
                x={212 + i * 14}
                y={74 + (i % 2 === 0 ? 0 : 4)}
                width={10}
                height={16 - (i % 2) * 4}
              />
            ))}
          </g>
          <Mark n={1} x={172} y={118} />
          <Mark n={2} x={286} y={62} />
          <Mark n={3} x={238} y={58} />
        </svg>
      }
    />
  );
}

/** A river gauge against its levels, and the person who decides what to do about it. */
export function GaugeFigure() {
  const t = useTranslations("howItWorks.figures.gauge");
  return (
    <Figure
      title={t("title")}
      caption={t("caption")}
      steps={[t("step1"), t("step2"), t("step3")]}
      legend={
        <ul className="flex flex-wrap gap-x-5 gap-y-2 text-small text-jaga-text">
          {(["watch", "warning", "evacuate"] as const).map((key) => (
            <li key={key} className="flex items-center gap-2">
              <span className={s.swatch} style={{ background: `var(--alert-${key})` }} />
              {t(`legend.${key}`)}
            </li>
          ))}
        </ul>
      }
      drawing={
        <svg
          className={s.frame}
          viewBox="0 0 320 132"
          role="img"
          aria-label={t("alt")}
          preserveAspectRatio="xMidYMid meet"
        >
          {/* The three levels of that gauge, in the alert palette, each also named in the list. */}
          {(
            [
              { y: 40, colour: "var(--alert-evacuate)" },
              { y: 62, colour: "var(--alert-warning)" },
              { y: 84, colour: "var(--alert-watch)" },
            ] as const
          ).map(({ y, colour }) => (
            <g key={y}>
              <path className={s.levelLine} d={`M20 ${y} L 300 ${y}`} style={{ stroke: colour }} />
              <rect x={6} y={y - 5} width={10} height={10} rx={2} style={{ fill: colour }} />
            </g>
          ))}
          {/* The river's own level, hour by hour. */}
          <path
            className={s.curve}
            d="M20 112 C 60 110 84 106 110 96 C 134 87 150 70 168 56 C 182 45 196 38 214 36 C 236 34 258 44 278 56 L 300 68"
          />
          {/* The hours between the first crossing and the water in the street. */}
          <path
            className={s.edge}
            d="M128 120 L 196 120 M132 116 L 128 120 L 132 124 M192 116 L 196 120 L 192 124"
          />
          <Mark n={1} x={120} y={92} />
          <Mark n={2} x={162} y={120} />
          <Mark n={3} x={236} y={22} />
        </svg>
      }
    />
  );
}

/** How far down the river an hour of release travels: measured, and stated as a range. */
const RIVER_STOPS = [
  { key: "dam", km: 0, first: null, high: null },
  { key: "bannangSata", km: 18, first: [3, 4], high: [3, 4] },
  { key: "yala", km: 78, first: [9, 18], high: [15, 26] },
  { key: "brido", km: 120, first: [14, 32], high: [40, 74] },
  { key: "pattani", km: 129, first: [16, 44], high: [45, 90] },
] as const;

export function RiverFigure() {
  const t = useTranslations("howItWorks.figures.river");
  const range = (pair: readonly [number, number] | null) =>
    pair ? t("range", { from: pair[0], to: pair[1] }) : t("atOnce");
  return (
    <Figure
      title={t("title")}
      caption={t("caption")}
      drawing={
        <div className="flex flex-col gap-3">
          <svg
            className={s.frame}
            viewBox="0 0 320 76"
            role="img"
            aria-label={t("alt")}
            preserveAspectRatio="xMidYMid meet"
          >
            {/* The dam, then the river to the sea; the dots are the gauges that were measured. */}
            <path className={s.land} d="M0 46 L 320 46 L 320 76 L 0 76 Z" />
            <path className={s.edge} d="M20 20 L 20 46" strokeWidth={3} />
            <path
              className={s.water}
              d="M20 40 C 90 36 130 48 200 42 C 250 38 290 44 320 40 L 320 52 C 290 56 250 50 200 54 C 130 60 90 48 20 52 Z"
            />
            {RIVER_STOPS.map((stop, i) => (
              <circle
                key={stop.key}
                className={s.dot}
                cx={20 + (stop.km / 132) * 280}
                cy={46}
                r={i === 0 ? 0 : 5}
              />
            ))}
            {/* The sea at the mouth. */}
            <path className={s.water} d="M300 46 L 320 46 L 320 76 L 300 76 Z" opacity={0.5} />
          </svg>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[18rem] text-start text-small">
              <thead>
                <tr className="text-jaga-text-2">
                  <th className="py-1 pe-3 text-start font-medium">{t("place")}</th>
                  <th className="py-1 pe-3 text-start font-medium">{t("firstRise")}</th>
                  <th className="py-1 text-start font-medium">{t("highest")}</th>
                </tr>
              </thead>
              <tbody>
                {RIVER_STOPS.map((stop) => (
                  <tr key={stop.key} className="border-t border-jaga-line">
                    <th scope="row" className="py-1.5 pe-3 text-start font-medium text-jaga-ink">
                      {t(`stops.${stop.key}`)}
                    </th>
                    <td className="py-1.5 pe-3 text-jaga-text">{range(stop.first)}</td>
                    <td className="py-1.5 text-jaga-text">{range(stop.high)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      }
    />
  );
}

/**
 * The system in five parts, as a grid rather than a drawing, so each label wraps like any text
 * at 360 px and in all three languages (the same reason as the hub on "What Jaga can do").
 */
export function SystemFigure() {
  const t = useTranslations("howItWorks.figures.system");
  return (
    <Figure
      title={t("title")}
      caption={t("caption")}
      drawing={
        <div className={`flex flex-col gap-2 rounded-2xl border border-jaga-line bg-jaga-ground p-4 ${s.fig}`}>
          <Box n={1}>{t("readers")}</Box>
          <span className={s.vline} />
          <Box n={2} strong>
            {t("db")}
          </Box>
          <span className={s.vline} />
          <div className="grid gap-2 sm:grid-cols-3">
            <Box n={3}>{t("app")}</Box>
            <Box n={4}>{t("notifier")}</Box>
            <Box n={5}>{t("files")}</Box>
          </div>
        </div>
      }
      steps={[t("step1"), t("step2"), t("step3"), t("step4"), t("step5")]}
    />
  );
}

function Box({ n, strong = false, children }: { n: number; strong?: boolean; children: ReactNode }) {
  return (
    <span
      className={`flex items-center gap-2 rounded-xl px-3 py-2 text-small font-medium ${
        strong
          ? "bg-jaga-slate text-white"
          : "border border-jaga-line bg-jaga-surface text-jaga-ink"
      }`}
    >
      <span
        className={`grid size-6 shrink-0 place-items-center rounded-full text-small font-bold ${
          strong ? "bg-white/15 text-white" : "bg-jaga-ground text-jaga-ink"
        }`}
      >
        {n}
      </span>
      {children}
    </span>
  );
}

/** What happens to a request for help, from the tap to the team on its way. */
export function SOSFigure() {
  const t = useTranslations("howItWorks.figures.sos");
  const steps = [t("step1"), t("step2"), t("step3"), t("step4"), t("step5")];
  return (
    <Figure
      title={t("title")}
      caption={t("caption")}
      drawing={
        <ol className={`flex flex-col gap-0 rounded-2xl border border-jaga-line bg-jaga-ground p-4 ${s.fig}`}>
          {steps.map((step, i) => (
            <li key={step} className="flex flex-col gap-0">
              <span className="flex items-start gap-3">
                <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-jaga-slate text-small font-bold text-white">
                  {i + 1}
                </span>
                <span className="text-jaga-text">{step}</span>
              </span>
              {i < steps.length - 1 && (
                <span className="ms-3.5 h-4 w-0 border-s-2 border-dashed border-jaga-teal-light" />
              )}
            </li>
          ))}
        </ol>
      }
    />
  );
}

/** The chevron between two stages of the workflow: across on a laptop, down on a phone. */
function Arrow() {
  return (
    <span className={s.wfArrow} aria-hidden="true">
      <svg viewBox="0 0 18 18">
        <path
          d="M3 9h11M10 4.5L14.5 9L10 13.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

/**
 * The workflow, as a GIS office would draw a model (the owner's request, 16 Oct): every chain of
 * work on one chart, from the open data it starts with, through the one analysis step that makes
 * it, to the product and the place in the app where that product is seen.
 *
 * Four shapes, the ones a flow chart uses: a parallelogram for data, a process box for the
 * analysis, a filled box for the product, and a dashed pill for the screen - which is a link into
 * the part of this page that explains that chain. The chains that feed each other say so, because
 * that is the part a reader cannot get from a list of layers.
 */
export function WorkflowFigure() {
  const t = useTranslations("howItWorks.figures.workflow");
  return (
    <Figure
      title={t("title")}
      caption={t("caption")}
      legend={
        <ul className={`${s.wfKey} text-jaga-text`}>
          <li>
            <span className={s.wfData} data-shape="data">
              {t("key.data")}
            </span>
          </li>
          <li>
            <span className={s.wfProcess} data-shape="analysis">
              {t("key.analysis")}
            </span>
          </li>
          <li>
            <span className={s.wfProduct} data-shape="product">
              {t("key.product")}
            </span>
          </li>
          <li>
            <span className={s.wfFeed} data-shape="feed">
              {t("key.feed")}
            </span>
          </li>
        </ul>
      }
      drawing={
        <div className={`${s.wf} ${s.fig}`} data-workflow>
          <div className={s.wfHead} aria-hidden="true">
            <span className={s.wfLabel}>{t("stages.data")}</span>
            <span />
            <span className={s.wfLabel}>{t("stages.analysis")}</span>
            <span />
            <span className={s.wfLabel}>{t("stages.product")}</span>
            <span />
            <span className={s.wfLabel}>{t("stages.app")}</span>
          </div>
          {WORKFLOW.map((row) => (
            <div key={row.key} className={s.wfRow} data-workflow-row={row.key}>
              <div className={s.wfCell}>
                <span className={s.wfLabel}>{t("stages.data")}</span>
                {row.sources.map((id) => (
                  <span key={id} className={s.wfData} data-workflow-source={id}>
                    {creditById(id)?.short ?? id}
                  </span>
                ))}
                {row.feeds?.map((from) => (
                  <span key={from} className={s.wfFeed} data-workflow-feed={from}>
                    {t(`rows.${from}.product`)}
                  </span>
                ))}
              </div>
              <Arrow />
              <div className={s.wfCell}>
                <span className={s.wfLabel}>{t("stages.analysis")}</span>
                <span className={s.wfProcess}>{t(`rows.${row.key}.method`)}</span>
              </div>
              <Arrow />
              <div className={s.wfCell}>
                <span className={s.wfLabel}>{t("stages.product")}</span>
                <span className={s.wfProduct}>{t(`rows.${row.key}.product`)}</span>
              </div>
              <Arrow />
              <div className={s.wfCell}>
                <span className={s.wfLabel}>{t("stages.app")}</span>
                <a className={s.wfApp} href={`#part-${row.part}`}>
                  {t(`rows.${row.key}.app`)}
                </a>
              </div>
            </div>
          ))}
        </div>
      }
    />
  );
}

/** The four stages, for a test that holds the chart to them. */
export const WORKFLOW_COLUMNS = WORKFLOW_STAGES;

/**
 * The architecture, end to end (the owner's request, 16 Oct): five bands read downwards, from
 * where the figures come from to the people at the end of it, with what travels between each
 * band written on the arrow. The middle band - the one place that holds everything and decides
 * who may read each row - is the one drawn differently, because that is the whole design.
 *
 * In general terms only: no supplier, product or brand is named here.
 */
export function ArchitectureFigure() {
  const t = useTranslations("howItWorks.figures.architecture");
  return (
    <Figure
      title={t("title")}
      caption={t("caption")}
      drawing={
        <div className={`${s.arch} ${s.fig}`} data-architecture>
          {ARCHITECTURE.map((tier) => (
            <div key={tier.key}>
              <div
                className={s.archTier}
                data-arch-tier={tier.key}
                data-core={tier.key === "core" ? "true" : undefined}
              >
                <div className={s.archHead}>
                  <span className={s.archTitle}>{t(`tiers.${tier.key}.title`)}</span>
                  <span className={s.archNote}>{t(`tiers.${tier.key}.note`)}</span>
                </div>
                <div className={s.archBoxes}>
                  {tier.boxes.map((box) => (
                    <span key={box} className={s.archBox} data-arch-box={box}>
                      <b>{t(`boxes.${box}.title`)}</b>
                      <span>{t(`boxes.${box}.text`)}</span>
                    </span>
                  ))}
                </div>
              </div>
              {tier.flow && (
                <p className={s.archFlow} data-arch-flow={tier.flow}>
                  <svg viewBox="0 0 18 18" aria-hidden="true">
                    <path
                      d="M9 3v11M4.5 9.5L9 14l4.5-4.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  {t(`flows.${tier.flow}`)}
                </p>
              )}
            </div>
          ))}
        </div>
      }
    />
  );
}

export const FIGURES = {
  radar: RadarFigure,
  height: HeightFigure,
  gauge: GaugeFigure,
  river: RiverFigure,
  system: SystemFigure,
  sos: SOSFigure,
} as const;
