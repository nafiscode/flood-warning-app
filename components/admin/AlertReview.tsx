"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { AlertBadge } from "@/components/alerts/AlertBadge";
import { DualTime } from "@/components/admin/DualTime";
import {
  ALERT_CHANNELS,
  DRILL_AUDIENCES,
  lineQuotaAfter,
  toPreview,
  updateHours,
  type AlertChannel,
  type AlertPreview,
  type DrillAudience,
} from "@/lib/alert-console";
import { buttonPrimary, buttonSecondary, checkBox, checkRow, errorNotice, hint } from "@/lib/ui";

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; error: "area" | "template" | "nextUpdate" | "unavailable" }
  | { kind: "ready"; preview: AlertPreview; launched: boolean; nextUpdateAt: string };

const LOCALES = ["th", "ms", "en"] as const;

/** Read when the admin presses review, never while rendering. */
const hoursFromNow = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();

/**
 * The step between filling the form and publishing (spec 6.2). It asks the server for the words
 * exactly as they would be sent and for who they would reach, and only then offers the publish
 * button - so nothing can be published that was not on the screen first. Changing anything in the
 * form takes the review away again. Evacuate adds a tick that must be made here, and the database
 * refuses an Evacuate without it.
 *
 * It sits inside the form and reads the form's own fields, so the form stays plain HTML.
 */
type Mode = "drill" | "drillSent" | "real";

export function AlertReview({ fixedMode }: { fixedMode?: "drill" | "real" }) {
  const t = useTranslations("alertConsole.review");
  const root = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<State>({ kind: "idle" });
  /*
   * Before launch the admin chooses, each time, between a drill nobody else sees and a real
   * alert (the owner, 13 Oct), and since 20 Oct between those and a drill that is sent: the
   * same road, the same sound, with words that say it is a drill. It starts on the silent
   * drill, so neither a real alert nor a drill anybody receives is ever the default.
   */
  const [chosen, setChosen] = useState<Mode>("drill");
  const [audience, setAudience] = useState<DrillAudience[]>([]);
  /*
   * Which roads it travels (the owner, 21 Oct). Push only to begin with (the owner, 22 Oct: no
   * paid LINE plan for now, and the free one is 500 messages a month). Ticking LINE is how an
   * admin chooses to spend the month's quota on this one alert.
   */
  const [channels, setChannels] = useState<AlertChannel[]>(["push"]);

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

  async function review(aud: DrillAudience[] = audience) {
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
          people: data.getAll("people"),
          note: data.get("note"),
          // So the words on the screen are the words that will be sent, drill or not.
          drillAudience: aud,
        }),
      });
      const body = (await response.json()) as {
        error?: string;
        preview?: unknown;
        launched?: boolean;
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
        launched: body.launched === true,
        nextUpdateAt: hoursFromNow(hours),
      });
    } catch {
      setState({ kind: "error", error: "unavailable" });
    }
  }

  const ready = state.kind === "ready" ? state : null;
  // Replacing an alert keeps its kind: a drill never takes a real alert off the map.
  const mode: Mode = fixedMode ?? (ready?.launched ? "real" : chosen);
  const canChoose = !!ready && !fixedMode && !ready.launched;
  const sent = mode === "drillSent";
  const drill = mode !== "real";

  /*
   * Changing who a drill goes to changes the words and the count, so the review is asked for
   * again rather than left standing: nothing may be published that was not on the screen.
   */
  function choose(next: Mode) {
    const wasSent = chosen === "drillSent";
    const nowSent = next === "drillSent";
    setChosen(next);
    const aud = nowSent ? (audience.length > 0 ? audience : ["admins" as const]) : [];
    setAudience(aud);
    // Only a change between sent and not sent changes the words; drill and real share them,
    // so switching between those two leaves the review standing, as it always has.
    if (wasSent !== nowSent && state.kind === "ready") void review(aud);
  }

  function toggle(who: DrillAudience) {
    const aud = audience.includes(who)
      ? audience.filter((a) => a !== who)
      : DRILL_AUDIENCES.filter((a) => a === who || audience.includes(a));
    setAudience(aud);
    if (state.kind === "ready") void review(aud);
  }
  const quota = ready ? lineQuotaAfter(ready.preview, channels) : null;

  return (
    <div ref={root} className="flex flex-col gap-4" data-alert-review={state.kind}>
      {!ready && (
        <button
          type="button"
          onClick={() => void review()}
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
          {canChoose ? (
            <fieldset className="flex flex-col rounded-xl border-2 border-jaga-edge px-3 py-1">
              <legend className="px-1 font-bold">{t("mode.legend")}</legend>
              {(["drill", "drillSent", "real"] as const).map((m) => (
                <label key={m} className={checkRow}>
                  <input
                    type="radio"
                    name="modeChoice"
                    value={m}
                    checked={chosen === m}
                    onChange={() => choose(m)}
                    className={checkBox}
                  />
                  <span>
                    <span className="font-bold">{t(`mode.${m}`)}</span>
                    <span className={`block ${hint}`}>{t(`mode.${m}Hint`)}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          ) : null}
          {/* What the server reads. "A drill that is sent" is still a drill to everything else. */}
          <input type="hidden" name="mode" value={drill ? "drill" : "real"} />
          {sent &&
            audience.map((who) => (
              <input key={who} type="hidden" name="drillAudience" value={who} />
            ))}

          {canChoose && sent && (
            <fieldset
              className="flex flex-col rounded-xl border-2 border-jaga-edge px-3 py-1"
              data-drill-audience={audience.join(" ")}
            >
              <legend className="px-1 font-bold">{t("audience.legend")}</legend>
              <p className={hint}>{t("audience.hint")}</p>
              {DRILL_AUDIENCES.map((who) => (
                <label key={who} className={checkRow}>
                  <input
                    type="checkbox"
                    checked={audience.includes(who)}
                    onChange={() => toggle(who)}
                    className={checkBox}
                  />
                  <span>
                    <span className="font-bold">{t(`audience.${who}`)}</span>
                    <span className={`block ${hint}`}>{t(`audience.${who}Hint`)}</span>
                  </span>
                </label>
              ))}
              {audience.length === 0 && (
                <p role="alert" className={errorNotice}>
                  {t("audience.none")}
                </p>
              )}
            </fieldset>
          )}
          {/*
            The roads. Shown whenever something would actually be sent; a silent drill travels
            none of them whatever is ticked, so the ticks would be noise there.
          */}
          {(sent || mode === "real") && (
            <fieldset
              className="flex flex-col rounded-xl border-2 border-jaga-edge px-3 py-1"
              data-channels={channels.join(" ")}
            >
              <legend className="px-1 font-bold">{t("channels.legend")}</legend>
              {ALERT_CHANNELS.map((c) => (
                <label key={c} className={checkRow}>
                  <input
                    type="checkbox"
                    name="channels"
                    value={c}
                    checked={channels.includes(c)}
                    onChange={() =>
                      setChannels(
                        channels.includes(c)
                          ? channels.filter((x) => x !== c)
                          : ALERT_CHANNELS.filter((x) => x === c || channels.includes(x)),
                      )
                    }
                    className={checkBox}
                  />
                  <span>
                    <span className="font-bold">{t(`channels.${c}`)}</span>
                    <span className={`block ${hint}`}>{t(`channels.${c}Hint`)}</span>
                  </span>
                </label>
              ))}
              {channels.length === 0 && (
                <p className={hint}>{t("channels.none")}</p>
              )}
            </fieldset>
          )}
          <p className={errorNotice} data-drill={drill} data-drill-sent={sent}>
            {mode === "real" ? t("real") : sent ? t("drillSent") : t("drill")}
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
              <DualTime iso={ready.nextUpdateAt} />
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
            <p className="font-bold">{sent ? t("reach.drillTitle") : t("reach.title")}</p>
            {sent && ready.preview.drillReach ? (
              <>
                {/* Who is actually about to be told, which is not the area's head count. */}
                <p data-drill-reach={ready.preview.drillReach.people}>
                  {t("reach.people", { count: ready.preview.drillReach.people })}
                </p>
                <p className={hint}>
                  {t("reach.channels", {
                    push: channels.includes("push") ? ready.preview.drillReach.push : 0,
                    line: channels.includes("line") ? ready.preview.drillReach.line : 0,
                  })}
                </p>
                <p className={hint}>
                  {t("reach.insteadOf", { count: ready.preview.reach.people })}
                </p>
              </>
            ) : (
              <>
                <p>{t("reach.people", { count: ready.preview.reach.people })}</p>
                <p className={hint}>
                  {t("reach.detail", {
                    homes: ready.preview.reach.homes,
                    watched: ready.preview.reach.watched,
                  })}
                </p>
                {/* Most of Jaga's accounts have never chosen a place; they are told anyway. */}
                {ready.preview.reach.noPlace > 0 && (
                  <p className={hint} data-reach-noplace={ready.preview.reach.noPlace}>
                    {t("reach.noPlace", { count: ready.preview.reach.noPlace })}
                  </p>
                )}
                <p className={hint}>
                  {t("reach.channels", {
                    push: channels.includes("push") ? ready.preview.reach.push : 0,
                    line: channels.includes("line") ? ready.preview.reach.line : 0,
                  })}
                </p>
              </>
            )}
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

          <button
            type="submit"
            className={buttonPrimary}
            disabled={sent && audience.length === 0}
            data-publish="true"
          >
            {mode === "real" ? t("publish") : sent ? t("publishDrillSent") : t("publishDrill")}
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
