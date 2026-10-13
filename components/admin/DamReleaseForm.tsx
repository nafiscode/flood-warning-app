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
import { buttonPrimary, card, hint, input, label } from "@/lib/ui";

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
}: {
  dams: DamForRelease[];
  send: (form: FormData) => void;
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
        })
      : null;

  return (
    <form action={send} className="flex flex-col gap-4" data-dam-release-form>
      <input type="hidden" name="notice" value={dam.noticeId ?? ""} />
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
        {t("damRelease.send")}
      </button>
    </form>
  );
}
