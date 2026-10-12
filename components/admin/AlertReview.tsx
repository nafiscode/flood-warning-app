"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { AlertBadge } from "@/components/alerts/AlertBadge";
import { DualTime } from "@/components/admin/DualTime";
import { lineQuotaAfter, toPreview, updateHours, type AlertPreview } from "@/lib/alert-console";
import { buttonPrimary, buttonSecondary, checkBox, checkRow, errorNotice, hint } from "@/lib/ui";

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; error: "area" | "template" | "nextUpdate" | "unavailable" }
  | { kind: "ready"; preview: AlertPreview; drill: boolean; nextUpdateAt: string };

const LOCALES = ["th", "ms", "en"] as const;

/**
 * The step between filling the form and publishing (spec 6.2). It asks the server for the words
 * exactly as they would be sent and for who they would reach, and only then offers the publish
 * button - so nothing can be published that was not on the screen first. Changing anything in the
 * form takes the review away again. Evacuate adds a tick that must be made here, and the database
 * refuses an Evacuate without it.
 *
 * It sits inside the form and reads the form's own fields, so the form stays plain HTML.
 */
export function AlertReview({ bangkokLabel }: { bangkokLabel: string }) {
  const t = useTranslations("alertConsole.review");
  const root = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<State>({ kind: "idle" });

  useEffect(() => {
    const form = root.current?.closest("form");
    if (!form) return;
    const reset = (event: Event) => {
      // The Evacuate tick lives in here; ticking it must not throw the review away.
      if (root.current?.contains(event.target as Node)) return;
      setState((s) => (s.kind === "idle" ? s : { kind: "idle" }));
    };
    form.addEventListener("change", reset);
    form.addEventListener("input", reset);
    return () => {
      form.removeEventListener("change", reset);
      form.removeEventListener("input", reset);
    };
  }, []);

  async function review() {
    const form = root.current?.closest("form");
    if (!form) return;
    const data = new FormData(form);
    const hours = updateHours(data.get("hours"));
    if (hours === null) return setState({ kind: "error", error: "nextUpdate" });
    setState({ kind: "loading" });
    try {
      const response = await fetch("/api/admin/alert-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          template: data.get("template"),
          province: data.getAll("province"),
          district: data.getAll("district"),
          tambon: data.getAll("tambon"),
          zone: data.getAll("zone"),
          note: data.get("note"),
        }),
      });
      const body = (await response.json()) as {
        error?: string;
        preview?: unknown;
        drill?: boolean;
      };
      const preview = toPreview(body.preview);
      if (!response.ok || !preview) {
        const error =
          body.error === "area" || body.error === "template" ? body.error : "unavailable";
        return setState({ kind: "error", error });
      }
      setState({
        kind: "ready",
        preview,
        drill: body.drill !== false,
        nextUpdateAt: new Date(Date.now() + hours * 3_600_000).toISOString(),
      });
    } catch {
      setState({ kind: "error", error: "unavailable" });
    }
  }

  const ready = state.kind === "ready" ? state : null;
  const quota = ready ? lineQuotaAfter(ready.preview) : null;

  return (
    <div ref={root} className="flex flex-col gap-4" data-alert-review={state.kind}>
      {!ready && (
        <button
          type="button"
          onClick={review}
          disabled={state.kind === "loading"}
          className={buttonSecondary}
          data-review="true"
        >
          {state.kind === "loading" ? t("loading") : t("button")}
        </button>
      )}
      {state.kind === "error" && (
        <p role="alert" className={errorNotice}>
          {t(`error.${state.error}`)}
        </p>
      )}

      {ready && (
        <section
          className="flex flex-col gap-4 rounded-2xl border-2 border-jaga-edge bg-jaga-surface p-5"
          aria-live="polite"
        >
          <h2 className="text-body font-bold text-jaga-ink">{t("title")}</h2>
          <p className={errorNotice} data-drill={ready.drill}>
            {ready.drill ? t("drill") : t("real")}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <AlertBadge level={ready.preview.level} />
            <span className="font-bold" data-review-tambons={ready.preview.tambons}>
              {t("tambons", { count: ready.preview.tambons })}
            </span>
          </div>
          <p>
            <span className={`block ${hint}`}>{t("nextUpdate")}</span>
            <span className="font-medium">
              <DualTime iso={ready.nextUpdateAt} bangkokLabel={bangkokLabel} />
            </span>
          </p>
          <p>
            <span className={`block ${hint}`}>{t("reason")}</span>
            <span className="font-medium" lang="th">
              {ready.preview.reason}
            </span>
          </p>
          {LOCALES.map((locale) => (
            <p key={locale} data-review-text={locale}>
              <span className={`block ${hint}`}>{t(`text.${locale}`)}</span>
              <span lang={locale}>{ready.preview.messages[locale]}</span>
            </p>
          ))}

          <div className="flex flex-col gap-1 rounded-xl bg-jaga-ground p-3">
            <p className="font-bold">{t("reach.title")}</p>
            <p>{t("reach.people", { count: ready.preview.reach.people })}</p>
            <p className={hint}>
              {t("reach.detail", {
                homes: ready.preview.reach.homes,
                watched: ready.preview.reach.watched,
              })}
            </p>
            <p className={hint}>
              {t("reach.channels", {
                push: ready.preview.reach.push,
                line: ready.preview.reach.line,
              })}
            </p>
            {quota && (
              <p className={quota.over ? "font-bold" : hint}>
                {t(quota.over ? "quotaOver" : "quota", { after: quota.after, limit: quota.limit })}
              </p>
            )}
            <p className={hint}>{t("reach.notYet")}</p>
          </div>

          {ready.preview.overlaps.length > 0 && (
            <p className={errorNotice} data-review-overlaps={ready.preview.overlaps.length}>
              {t("overlaps", { count: ready.preview.overlaps.length })}
            </p>
          )}

          {ready.preview.level === "evacuate" && (
            <label className={`${checkRow} rounded-xl border-2 border-jaga-edge px-3`}>
              <input
                type="checkbox"
                name="confirmEvacuate"
                value="yes"
                required
                className={checkBox}
              />
              <span className="font-bold">{t("evacuate", { count: ready.preview.tambons })}</span>
            </label>
          )}

          <button type="submit" className={buttonPrimary} data-publish="true">
            {ready.drill ? t("publishDrill") : t("publish")}
          </button>
          <button
            type="button"
            onClick={() => setState({ kind: "idle" })}
            className={buttonSecondary}
          >
            {t("back")}
          </button>
        </section>
      )}
    </div>
  );
}
