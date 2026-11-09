"use client";

import { useState } from "react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { WaveIcon } from "@/components/icons";
import type { DamArrival } from "@/lib/dam-arrival";
import {
  bangkokInput,
  DEFAULT_RELEASE_LEVEL,
  releaseText,
  RELEASE_LEVELS,
  zoneEnds,
  zoneWindow,
  type ReleaseLevel,
} from "@/lib/dam-release";
import { localName } from "@/lib/places";
import { BANGKOK_DATE_TIME } from "@/lib/time";
import { buttonPrimary, card, checkBox, checkRow, hint, input, label } from "@/lib/ui";

export type DamForRelease = {
  code: string;
  name: Record<string, string>;
  river: Record<string, string>;
  operator: string;
  tambons: number;
  arrivals: DamArrival[];
  /** The newest published outflow, to save the sender typing a figure they already have. */
  outflowCms: number | null;
  /** An open war-room row this answers, so sending marks it done. */
  noticeId: string | null;
};

/**
 * The sending screen (docs/spec.md section 15).
 *
 * The person fills in four things - when the gates opened, how much is leaving, until when, and
 * the level - and reads the notice before it goes. **They cannot write a word of it**: the text
 * below the form is built from the same reviewed template the server will send, from the same
 * figures, so what they read is what arrives. The zone is S7's and has no control at all.
 */
/** Half hours under two, whole hours above: never days. */
const wholeHours = (h: number) => (h < 2 ? Math.round(h * 2) / 2 : Math.round(h));

export function DamReleaseForm({
  dams,
  send,
  nowValue,
  nextUpdateValue,
  operatorSend,
  operatorSendDrill,
  variant = "admin",
}: {
  dams: DamForRelease[];
  send: (form: FormData) => void;
  /**
   * The dam operator's own screen (spec 15, built 9 Nov 2026 as A12 part 2). The same four
   * figures and the same three levels an admin has - the owner chose that on 9 Nov, so there is
   * one rule to teach - with their own dam filled in and the issuer line that says the dam sent
   * it. These two are the button's labels, the second for when the drill switch is on.
   */
  operatorSend?: string;
  operatorSendDrill?: string;
  /**
   * Who is at the keyboard. It changes three things and nothing else: which dams the select
   * offers (the server has already narrowed them), the last line of the notice, and the button.
   */
  variant?: "admin" | "operator";
  /** Bangkok wall-clock defaults, computed on the server so the first paint matches. */
  nowValue: string;
  nextUpdateValue: string;
}) {
  const t = useTranslations("admin");
  const td = useTranslations("dam");
  const ta = useTranslations("alert");
  const locale = useLocale();
  const format = useFormatter();
  const [code, setCode] = useState(dams[0]?.code ?? "");
  const dam = dams.find((d) => d.code === code) ?? dams[0];
  const [gates, setGates] = useState(nowValue);
  const [cms, setCms] = useState(dam?.outflowCms ? String(Math.round(dam.outflowCms)) : "");
  const [end, setEnd] = useState("");
  const [level, setLevel] = useState<ReleaseLevel>(DEFAULT_RELEASE_LEVEL);
  /**
   * The drill switch (the owner, 9 Nov 2026). Off every time the screen is opened: a switch that
   * remembered it was on is a way to rehearse a real release by accident, which is the one
   * mistake this whole screen is built to make impossible.
   */
  const [drill, setDrill] = useState(false);
  const operator = variant === "operator";
  const onlyDam = dams.length === 1;

  if (!dam) return <p className={hint}>{t("damRelease.noDam")}</p>;

  const gatesAt = bangkokInput(gates);
  const releaseCms = Number.parseFloat(cms);
  const ends = zoneEnds(dam.arrivals);
  const time = (at: Date) => format.dateTime(at, BANGKOK_DATE_TIME);
  const preview =
    gatesAt && Number.isFinite(releaseCms) && releaseCms > 0
      ? releaseText(td, time, {
          damName: localName(dam.name, locale),
          river: localName(dam.river, locale),
          operator: dam.operator,
          gatesOpenAt: gatesAt,
          releaseCms,
          expectedEndAt: bangkokInput(end),
          onset: zoneWindow(dam.arrivals, gatesAt),
          byOperator: operator,
        })
      : null;

  return (
    <form
      action={send}
      className="flex flex-col gap-4"
      data-dam-release-form
      data-operator={operator ? "true" : undefined}
    >
      <input type="hidden" name="notice" value={dam.noticeId ?? ""} />
      {/*
       * One dam: its name, not a chooser with a single entry. A control room holding one
       * structure should not have to pick it, and most do hold exactly one. Two or more (the
       * irrigation office holds four of the six reservoirs) and the chooser comes back, offering
       * only the dams the server already narrowed to this account.
       */}
      {onlyDam ? (
        <>
          <input type="hidden" name="dam" value={dam.code} />
          <p className="font-bold text-jaga-ink">{localName(dam.name, locale)}</p>
        </>
      ) : (
        <div className="flex flex-col gap-1">
          <label className={label} htmlFor="dam">
            {t("damRelease.dam")}
          </label>
          <select
            id="dam"
            name="dam"
            className={input}
            value={code}
            onChange={(e) => setCode(e.target.value)}
          >
            {dams.map((d) => (
              <option key={d.code} value={d.code}>
                {localName(d.name, locale)}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <label className={label} htmlFor="gatesOpenAt">
          {t("damRelease.gatesOpenAt")}
        </label>
        <input
          id="gatesOpenAt"
          name="gatesOpenAt"
          type="datetime-local"
          required
          className={input}
          value={gates}
          onChange={(e) => setGates(e.target.value)}
        />
        <p className={hint}>{t("damRelease.gatesHint")}</p>
      </div>

      <div className="flex flex-col gap-1">
        <label className={label} htmlFor="releaseCms">
          {t("damRelease.releaseCms")}
        </label>
        <input
          id="releaseCms"
          name="releaseCms"
          type="number"
          min="1"
          step="1"
          inputMode="numeric"
          required
          className={`${input} w-40`}
          value={cms}
          onChange={(e) => setCms(e.target.value)}
        />
        <p className={hint}>{t("damRelease.releaseHint")}</p>
      </div>

      <div className="flex flex-col gap-1">
        <label className={label} htmlFor="expectedEnd">
          {t("damRelease.expectedEnd")}
        </label>
        <input
          id="expectedEnd"
          name="expectedEnd"
          type="datetime-local"
          className={input}
          value={end}
          onChange={(e) => setEnd(e.target.value)}
        />
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className={label}>{t("damRelease.level")}</legend>
        {RELEASE_LEVELS.map((l) => (
          <label key={l} className="flex min-h-tap items-center gap-3">
            <input
              type="radio"
              name="level"
              value={l}
              checked={level === l}
              onChange={() => setLevel(l)}
              className="h-5 w-5"
            />
            <span>{ta(`level.${l}`)}</span>
          </label>
        ))}
        <p className={hint}>{t("damRelease.levelHint")}</p>
      </fieldset>

      <div className="flex flex-col gap-1">
        <label className={label} htmlFor="nextUpdate">
          {t("damRelease.nextUpdate")}
        </label>
        <input
          id="nextUpdate"
          name="nextUpdate"
          type="datetime-local"
          required
          className={input}
          defaultValue={nextUpdateValue}
        />
      </div>

      {/* The zone and the measured arrival ranges: shown, never editable. */}
      <div className={`${card} gap-2`}>
        <p className="flex items-center gap-2 font-medium text-jaga-ink">
          <WaveIcon size={20} aria-hidden="true" />
          {t("damRelease.zone", { count: dam.tambons })}
        </p>
        {ends && (
          <p className={hint}>
            {t("damRelease.arrivals", {
              // Always hours: the sentence says hours. spanOf turns a range that reaches two
              // days into days, which printed "0.5–2 hours" for a tambon two days away.
              firstFrom: wholeHours(ends.first.warnFromH),
              firstTo: wholeHours(ends.first.latestH),
              lastFrom: wholeHours(ends.last.warnFromH),
              lastTo: wholeHours(ends.last.latestH),
            })}
          </p>
        )}
      </div>

      {/*
       * The drill switch (the owner, 9 Nov 2026). Everything about this send is real except who
       * hears it: the same function, the same zone, the same template, and the admins alone at
       * the far end. It is how the people at the dam can press this button in their control room
       * in front of somebody, and how the admins' own screen can finally be rehearsed.
       */}
      <label className={checkRow} data-dam-release-drill>
        <input
          type="checkbox"
          name="drill"
          value="yes"
          checked={drill}
          onChange={(e) => setDrill(e.target.checked)}
          className={checkBox}
        />
        <span>
          {t("damRelease.drill")}
          <span className={`block ${hint}`}>{t("damRelease.drillHint")}</span>
        </span>
      </label>

      <div className="flex flex-col gap-2">
        <p className={label}>{t("damRelease.preview")}</p>
        <p className={hint}>{t("damRelease.previewHint")}</p>
        <pre
          data-dam-release-preview
          className="whitespace-pre-wrap rounded-xl border border-jaga-line bg-jaga-ground p-3 font-sans text-base"
        >
          {preview ?? "—"}
        </pre>
      </div>

      <button type="submit" className={`${buttonPrimary} self-start`} disabled={!preview}>
        {operator
          ? ((drill ? operatorSendDrill : operatorSend) ?? t("damRelease.send"))
          : t("damRelease.send")}
      </button>
    </form>
  );
}
