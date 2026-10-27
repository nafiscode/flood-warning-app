import { DualTime } from "@/components/admin/DualTime";
import { CheckIcon, ClockIcon, TriangleIcon, WaveIcon } from "@/components/icons";
import type { DamLevel } from "@/lib/dam";
import { damLevel, operatorName } from "@/lib/dam";
import type { DamLevels } from "@/lib/dam-levels";
import { damRuleGap, shareAsMcm } from "@/lib/dam-levels";
import { localName } from "@/lib/places";
import { buttonPrimary, buttonSecondary, card, hint, input, label } from "@/lib/ui";

type T = (key: string, values?: Record<string, string | number>) => string;

/** One decimal, and never a trailing ".0" where a whole number will do. */
const pct = (value: number | null): string =>
  value === null ? "" : String(Math.round(value * 10) / 10);

/*
 * The same pill the public dam card wears, with this panel's own words.
 *
 * It does not reuse DamStateChip, which is a client component reading the `dam` namespace: that
 * namespace is not among the few the layout hands to the browser (lib/messages.ts,
 * layoutMessages), so on this page the chip printed "dam.state.releasing" at a reader. The
 * colours and icons are the card's, so the two cannot drift apart in meaning; the words are this
 * panel's, so it depends on nothing it was not given.
 */
const CHIP_CLASS: Record<DamLevel, string> = {
  unknown: "bg-alert-stale text-alert-stale-fg",
  normal: "bg-alert-normal text-alert-normal-fg",
  watch: "bg-alert-watch text-alert-watch-fg",
  releasing: "bg-alert-evacuate text-alert-evacuate-fg",
};

const CHIP_ICON: Record<DamLevel, typeof CheckIcon> = {
  unknown: ClockIcon,
  normal: CheckIcon,
  watch: TriangleIcon,
  releasing: WaveIcon,
};

function StateChip({ dam, t }: { dam: DamLevels; t: T }) {
  const level = damLevel(dam.signal);
  const Icon = CHIP_ICON[level];
  return (
    <span
      data-reservoir-state={level}
      className={`inline-flex min-h-tap items-center gap-2 self-start rounded-full px-4 py-1 font-bold ${CHIP_CLASS[level]}`}
    >
      <Icon size={24} aria-hidden="true" />
      {/* Never the colour alone: the icon and the word ride with it (docs/brand.md). */}
      <span>{t(`reservoirs.state.${level}`)}</span>
    </span>
  );
}

/**
 * The reservoirs on the signals dashboard: what each is doing now, the two shares of capacity it
 * is graded on, and the tick that lets the automatic alarm publish its draft (the owner, 27 Oct
 * 2026: "threshold can adjust later, and can click enable if I want automatic alarm or not").
 *
 * It is the river gauges' panel for reservoirs, and it is deliberately the same shape: the live
 * figure, the thresholds in boxes an admin can type into, and one switch. Three things it says
 * that the gauges' panel does not have to:
 *
 *   * the share in **million cubic metres** beside the percentage, because that is the figure an
 *     operator reads and 95% of 6 Mm³ means nothing until it says 5.7;
 *   * **why a rule cannot fire** - no threshold, nobody in its zone to warn, or no reading at all.
 *     A reservoir armed with no threshold looks armed and is not, and that gap must not be left
 *     for somebody to work out from an empty box;
 *   * that what the tick allows is a **Warning**, never an Evacuate, and that a person still gets
 *     the grace time to send or stop it (safety rule 2).
 */
export function ReservoirLevels({
  dams,
  t,
  locale,
  levelsAction,
  autoAction,
}: {
  dams: DamLevels[];
  t: T;
  locale: string;
  /** Saves one reservoir's two shares. */
  levelsAction?: (form: FormData) => void;
  /** Arms or disarms the automatic alarm for one reservoir. */
  autoAction?: (form: FormData) => void;
}) {
  if (dams.length === 0) return null;
  const armed = dams.filter((d) => d.auto).length;
  return (
    <section id="reservoirs" className="flex scroll-mt-28 flex-col gap-3" data-reservoirs={dams.length}>
      <h2 className="text-body font-bold text-jaga-ink">{t("reservoirs.title")}</h2>
      <p className={hint}>{t("reservoirs.intro")}</p>
      <p className={hint}>{t("reservoirs.armedCount", { armed, total: dams.length })}</p>
      <div className="grid gap-4 lg:grid-cols-2">
        {dams.map((dam) => {
          const gap = damRuleGap(dam);
          const full = dam.signal?.percentFull ?? null;
          return (
            <article key={dam.code} className={card} data-reservoir={dam.code}>
              <header className="flex flex-col gap-1">
                <h3 className="text-h3 font-bold text-jaga-ink">{localName(dam.name, locale)}</h3>
                <p className={hint}>
                  {t("reservoirs.operator", { operator: operatorName(dam.operator, t) })}
                  {dam.storageMaxMcm !== null
                    ? ` · ${t("reservoirs.capacity", { mcm: dam.storageMaxMcm })}`
                    : ""}
                  {` · ${t(`reservoirs.feed.${dam.feed === "hourly" ? "hourly" : "daily"}`)}`}
                </p>
              </header>

              {/* What it is doing now, in the same colours the public card uses. */}
              <StateChip dam={dam} t={t} />
              {dam.signal ? (
                <>
                  <p className="font-medium" data-reservoir-now>
                    {full === null
                      ? t("reservoirs.noFigure")
                      : t("reservoirs.now", {
                          percent: pct(full),
                          mcm: dam.signal.storageMcm ?? 0,
                        })}
                  </p>
                  <p className={hint}>
                    {t("reservoirs.observed")} <DualTime iso={dam.signal.observedAt} />
                    {dam.signal.stale ? ` · ${t("reservoirs.stale")}` : ""}
                  </p>
                  {dam.signal.reasons.map((reason) => (
                    <p key={reason}>{t(`reservoirs.reason.${reason}`)}</p>
                  ))}
                </>
              ) : (
                <p className="font-medium">{t("reservoirs.noReading")}</p>
              )}

              {/* The two shares, in boxes. Empty takes the rule off, which the hint says. */}
              <form
                action={levelsAction}
                className="flex flex-col gap-2 border-t border-jaga-line pt-3"
                data-reservoir-levels={dam.code}
              >
                <input type="hidden" name="dam" value={dam.code} />
                <p className="font-bold">{t("reservoirs.thresholds")}</p>
                {/*
                 * One box per row on a phone: side by side at 360 px the two labels wrap to
                 * different heights, so the inputs and their "= x Mm3" lines sat at different
                 * heights, and each box was half of a narrow screen to type a number into.
                 */}
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="flex flex-col gap-1">
                    <span className={label}>{t("reservoirs.nearFull")}</span>
                    <input
                      className={input}
                      name="nearFull"
                      inputMode="decimal"
                      defaultValue={pct(dam.nearFullPct)}
                      data-level="nearFull"
                    />
                    <span className={hint}>
                      {shareAsMcm(dam, dam.nearFullPct) === null
                        ? t("reservoirs.off")
                        : t("reservoirs.asMcm", { mcm: shareAsMcm(dam, dam.nearFullPct)! })}
                    </span>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className={label}>{t("reservoirs.full")}</span>
                    <input
                      className={input}
                      name="full"
                      inputMode="decimal"
                      defaultValue={pct(dam.fullPct)}
                      data-level="full"
                    />
                    <span className={hint}>
                      {shareAsMcm(dam, dam.fullPct) === null
                        ? t("reservoirs.off")
                        : t("reservoirs.asMcm", { mcm: shareAsMcm(dam, dam.fullPct)! })}
                    </span>
                  </label>
                </div>
                <p className={hint}>{t("reservoirs.thresholdsHint")}</p>
                {levelsAction ? (
                  <button type="submit" className={`${buttonPrimary} self-start`}>
                    {t("reservoirs.save")}
                  </button>
                ) : null}
              </form>

              {/* The tick, and what it actually allows. */}
              <form
                action={autoAction}
                className="flex flex-col gap-2 rounded-xl border border-jaga-line p-3"
                data-reservoir-auto={dam.code}
              >
                <input type="hidden" name="dam" value={dam.code} />
                <label className="flex min-h-tap items-center gap-2">
                  <input
                    type="checkbox"
                    name="enabled"
                    defaultChecked={dam.auto}
                    className="h-6 w-6"
                  />
                  <span className="font-medium">{t("reservoirs.auto")}</span>
                </label>
                <p className={hint}>{t("reservoirs.autoHint")}</p>
                {dam.auto && dam.autoSetAt ? (
                  <p className={hint}>
                    {t("reservoirs.autoSince", { who: dam.autoSetBy ?? t("reservoirs.autoBySeed") })}{" "}
                    <DualTime iso={dam.autoSetAt} />
                  </p>
                ) : null}
                {/* Armed but unable to fire: said here, where the tick is. */}
                {dam.auto && gap ? (
                  <p className="font-medium" data-reservoir-gap={gap}>
                    {t(`reservoirs.gap.${gap}`)}
                  </p>
                ) : null}
                {!dam.auto && gap === "noZone" ? (
                  <p className={hint} data-reservoir-gap={gap}>
                    {t("reservoirs.gap.noZone")}
                  </p>
                ) : null}
                {autoAction ? (
                  <button type="submit" className={`${buttonSecondary} w-auto self-start px-4`}>
                    {t("reservoirs.saveAuto")}
                  </button>
                ) : null}
              </form>

              <p className={hint}>{t("reservoirs.zone", { count: dam.tambons })}</p>
            </article>
          );
        })}
      </div>
    </section>
  );
}
