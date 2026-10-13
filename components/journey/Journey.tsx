import { useFormatter, useTranslations } from "next-intl";
import { CheckIcon, ClockIcon } from "@/components/icons";
import type { Journey as JourneyData, JourneyStep } from "@/lib/journey";
import { BANGKOK_DATE_TIME } from "@/lib/time";
import { hint } from "@/lib/ui";

/**
 * The line of steps a request goes through (the owner, 13 Oct): what is done, what is being
 * waited for now, what comes after. The same picture for a request for help, a request for food
 * and water, a team's registration and a flood report.
 *
 * A step's state is never carried by colour alone: done has a tick, the current one a clock and
 * the word "now", a stopped one a bar, and each says its state in words for a screen reader.
 * The colours are the brand's own, never the alert palette: this is progress, not a level.
 */
export function Journey({ journey, compact = false }: { journey: JourneyData; compact?: boolean }) {
  const t = useTranslations("journey");
  const format = useFormatter();
  const words = (step: JourneyStep) =>
    t(`${journey.kind}.steps.${step.key}`, { name: step.name ?? t("aTeam") });

  return (
    <ol
      className="flex flex-col"
      data-journey={journey.kind}
      data-journey-open={journey.open}
      aria-label={t("label")}
    >
      {journey.steps.map((step, i) => {
        const last = i === journey.steps.length - 1;
        return (
          <li
            key={step.key}
            className="grid grid-cols-[1.75rem_1fr] gap-x-3"
            data-step={step.key}
            data-step-state={step.state}
            aria-current={step.state === "now" ? "step" : undefined}
          >
            <span className="flex flex-col items-center" aria-hidden="true">
              <span
                className={`flex size-7 shrink-0 items-center justify-center rounded-full border-2 ${
                  step.state === "done"
                    ? "border-jaga-teal-ink bg-jaga-teal-ink text-jaga-surface"
                    : step.state === "now"
                      ? "border-jaga-teal-ink bg-jaga-surface text-jaga-teal-ink"
                      : step.state === "stopped"
                        ? "border-jaga-edge bg-jaga-edge text-jaga-surface"
                        : "border-jaga-line bg-jaga-surface text-jaga-text-2"
                }`}
              >
                {step.state === "done" && <CheckIcon size={16} />}
                {step.state === "now" && <ClockIcon size={16} />}
                {step.state === "stopped" && <span className="h-0.5 w-3 bg-current" />}
              </span>
              {!last && (
                <span
                  className={`w-0.5 grow ${step.state === "done" ? "bg-jaga-teal-ink" : "bg-jaga-line"}`}
                />
              )}
            </span>
            <div className={`flex flex-col ${last ? "" : compact ? "pb-3" : "pb-4"}`}>
              <p
                className={
                  step.state === "now"
                    ? "font-bold text-jaga-ink"
                    : step.state === "todo"
                      ? "text-jaga-text-2"
                      : "font-medium"
                }
              >
                <span className="sr-only">{t(`state.${step.state}`)}: </span>
                {words(step)}
                {step.state === "now" && (
                  <span className="ms-2 inline-block rounded-full border border-jaga-teal-ink px-2 text-small font-bold text-jaga-ink">
                    {t("now")}
                  </span>
                )}
              </p>
              {step.state === "now" && !compact && (
                <p className={hint}>{t(`${journey.kind}.wait.${step.key}`)}</p>
              )}
              {step.at && (
                <p className={`${hint} tabular-nums`}>
                  {format.dateTime(new Date(step.at), BANGKOK_DATE_TIME)}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
