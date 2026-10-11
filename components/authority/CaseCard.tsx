"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import {
  CheckIcon,
  ClockIcon,
  LifebuoyIcon,
  PhoneIcon,
  PinIcon,
  TriangleIcon,
  WaveIcon,
} from "@/components/icons";
import { Link } from "@/i18n/navigation";
import {
  DECLINE_REASONS,
  ETA_BANDS,
  RELEASE_REASONS,
  caseState,
  clockText,
  coordsText,
  directionsHref,
  needsEta,
  nextStep,
  secondsLeft,
  splitMinutes,
  vulnerableKeys,
  type BoardCase,
  type CaseState,
  type DeclineReason,
  type EtaBand,
  type ReleaseReason,
} from "@/lib/dispatch";
import { buttonPrimary, buttonSecondary, hint } from "@/lib/ui";

/**
 * One case on a team's board (spec 5.2, 5.3). What it offers follows what the team should do
 * next: answer the offer, give an estimate, report the next step, or give the case back.
 *
 * Accepting is one tap and asks nothing first. The arrival estimate is asked straight after, and
 * the card keeps asking until it has one. Declining and giving back each take a reason, chosen
 * from a short list - nobody types in the middle of a flood.
 */

export type CaseActions = {
  accept: (sosId: string) => void;
  decline: (sosId: string, reason: DeclineReason) => void;
  eta: (sosId: string, band: EtaBand) => void;
  advance: (sosId: string, status: "en_route" | "on_site") => void;
  release: (sosId: string, reason: ReleaseReason) => void;
  phone: (sosId: string) => void;
};

type Props = {
  c: BoardCase;
  now: number;
  busy: boolean;
  /** Set once the number was asked for; `number` is null when the sender gave none. */
  phone: { number: string | null } | null;
  actions: CaseActions;
};

const STATE_ICON: Record<CaseState, typeof CheckIcon> = {
  offered_to_me: TriangleIcon,
  unanswered: TriangleIcon,
  searching: ClockIcon,
  mine: LifebuoyIcon,
  held_by_other: LifebuoyIcon,
  closed: CheckIcon,
};

/** Filled red where somebody must act; neutral outlines for the rest. */
const STATE_CLASS: Record<CaseState, string> = {
  offered_to_me: "bg-sos text-sos-fg",
  unanswered: "bg-sos text-sos-fg",
  searching: "border-2 border-jaga-edge bg-jaga-surface text-jaga-ink",
  mine: "border-2 border-jaga-teal-ink bg-jaga-surface text-jaga-ink",
  held_by_other: "border-2 border-jaga-edge bg-jaga-surface text-jaga-ink",
  closed: "bg-alert-stale text-alert-stale-fg",
};

const bangkok = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Bangkok",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const bangkokClock = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Bangkok",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const act =
  "inline-flex min-h-tap items-center justify-center gap-2 rounded-xl border-2 border-jaga-edge bg-jaga-surface px-3 py-2 text-center font-medium text-jaga-ink active:translate-y-px disabled:opacity-60";

function Chip({ children, strong = false }: { children: ReactNode; strong?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-small ${
        strong ? "border-jaga-edge font-bold text-jaga-ink" : "border-jaga-line text-jaga-text-2"
      }`}
    >
      {children}
    </span>
  );
}

export function CaseCard({ c, now, busy, phone, actions }: Props) {
  const t = useTranslations("authority");
  const tSos = useTranslations("sos");
  const tReport = useTranslations("report");
  const locale = useLocale();
  const [asking, setAsking] = useState<"decline" | "release" | "eta" | null>(null);
  const [copied, setCopied] = useState(false);

  const state = caseState(c);
  const Icon = STATE_ICON[state];
  const left = state === "offered_to_me" ? (secondsLeft(c, now) ?? 0) : null;
  const open = state !== "closed";
  const canAccept = state === "offered_to_me" || state === "searching" || state === "unanswered";
  const step = nextStep(c);
  const askEta = needsEta(c) || (state === "mine" && asking === "eta");

  const thai = c.tambonNameTh ?? "";
  const place = locale === "th" || !c.tambonNameEn ? thai : `${thai} (${c.tambonNameEn})`;
  // The waiting time moves with the clock between refreshes, from the moment the case was sent.
  const waited = splitMinutes(Math.max(0, (now - Date.parse(c.createdAt)) / 60_000));
  const waitedText =
    waited.hours > 0 ? t("time.hm", waited) : t("time.m", { minutes: waited.minutes });
  const vulnerable = vulnerableKeys(c.vulnerableFlags);

  const words =
    state === "held_by_other"
      ? t("state.held_by_other", { unit: c.claimedByName ?? "" })
      : state === "searching"
        ? c.offeredToName
          ? t("state.searching", { unit: c.offeredToName })
          : t("state.searchingNoName")
        : t(`state.${state}`);

  async function copy() {
    try {
      await navigator.clipboard.writeText(coordsText(c.lat, c.lon));
      setCopied(true);
    } catch {
      // No clipboard: the coordinates are written on the card, to be read out or typed.
    }
  }

  return (
    <article
      data-case={c.sosId}
      data-case-state={state}
      className={`flex flex-col gap-3 rounded-2xl bg-jaga-surface p-4 ${
        state === "offered_to_me" || state === "unanswered"
          ? "border-2 border-sos"
          : "border border-jaga-line"
      }`}
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <span
          className={`inline-flex min-h-tap items-center gap-2 rounded-xl px-3 py-1 font-bold ${STATE_CLASS[state]}`}
        >
          <Icon size={20} />
          {words}
        </span>
        <span className={`${hint} tabular-nums`}>#{c.sosId.slice(0, 8)}</span>
      </header>

      {left !== null && (
        <div className="flex flex-col gap-1" role="timer" aria-live="off">
          <p className="text-h3 font-bold tabular-nums text-jaga-ink" data-countdown={left}>
            {t("countdown", { time: clockText(left) })}
          </p>
          <p className={hint}>{t("countdownHint")}</p>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <p className="font-bold text-jaga-ink">{place || t("case.noArea")}</p>
        {c.locationText && <p className={hint}>{t("case.typedPlace", { text: c.locationText })}</p>}
        <p className={hint}>
          {t("case.sentAt", { time: bangkok.format(new Date(c.createdAt)) })}
          {open ? ` · ${t("case.waited", { time: waitedText })}` : ""}
          {c.accuracyM != null ? ` · ${t("case.accuracy", { m: Math.round(c.accuracyM) })}` : ""}
        </p>
        {state !== "closed" && c.status !== "received" && (
          <p className="font-medium">{t(`status.${c.status}`)}</p>
        )}
        {state === "closed" && <p className="font-medium">{t(`status.${c.status}`)}</p>}
      </div>

      <div className="flex flex-wrap gap-2">
        {c.hazard !== "unknown" && tSos.has(`hazard.${c.hazard}`) && (
          <Chip>{tSos(`hazard.${c.hazard}` as "hazard.flood")}</Chip>
        )}
        {c.peopleCount != null && <Chip strong>{t("case.people", { count: c.peopleCount })}</Chip>}
        {c.depthRef && (
          <Chip strong>
            <WaveIcon size={18} />
            {tReport(`depths.${c.depthRef}` as "depths.knee")}
          </Chip>
        )}
        {vulnerable.map((k) => (
          <Chip key={k} strong>
            {tSos.has(`vulnerable.${k}`) ? tSos(`vulnerable.${k}` as "vulnerable.elderly") : k}
          </Chip>
        ))}
        <Chip>{c.hasPhone ? t("case.hasPhone") : t("case.noPhone")}</Chip>
        {c.photos.length > 0 && <Chip>{t("case.photos", { count: c.photos.length })}</Chip>}
        {c.voiceUrl && <Chip>{t("case.voice")}</Chip>}
      </div>

      {c.injuries && <p className="font-medium">{t("case.injuries", { text: c.injuries })}</p>}
      {c.note && <p>{t("case.said", { text: c.note })}</p>}
      {c.suspectedSpam && (
        <p className="rounded-xl border-2 border-jaga-edge px-3 py-2 font-medium">
          {t("case.spamFlag")}
        </p>
      )}
      {state === "unanswered" && <p className="font-medium">{t("case.unansweredNote")}</p>}
      {canAccept && c.myResponse === "declined" && <p className={hint}>{t("case.declined")}</p>}
      {canAccept && c.myResponse === "timed_out" && state !== "offered_to_me" && (
        <p className={hint}>{t("case.timedOut")}</p>
      )}

      {/* Accepting is the claim: one tap, nothing asked first (spec 5.2). */}
      {canAccept && (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => actions.accept(c.sosId)}
            data-accept="true"
            className={`${buttonPrimary} min-h-16 text-h3 font-bold`}
          >
            {busy ? t("act.working") : t("act.accept")}
          </button>
          {state === "offered_to_me" && asking !== "decline" && (
            <button
              type="button"
              disabled={busy}
              onClick={() => setAsking("decline")}
              data-decline="true"
              className={buttonSecondary}
            >
              {t("act.decline")}
            </button>
          )}
          {state === "offered_to_me" && asking === "decline" && (
            <fieldset className="flex flex-col gap-2 border-t border-jaga-line pt-3">
              <legend className="font-bold text-jaga-ink">{t("act.declineWhy")}</legend>
              <div className="grid grid-cols-2 gap-2">
                {DECLINE_REASONS.map((reason) => (
                  <button
                    key={reason}
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setAsking(null);
                      actions.decline(c.sosId, reason);
                    }}
                    data-decline-reason={reason}
                    className={act}
                  >
                    {t(`decline.${reason}`)}
                  </button>
                ))}
              </div>
            </fieldset>
          )}
        </div>
      )}

      {/* The estimate: asked straight after accepting, and until it is given. */}
      {state === "mine" && askEta && (
        <fieldset
          className="flex flex-col gap-2 rounded-xl border-2 border-jaga-teal-ink p-3"
          data-eta-ask="true"
        >
          <legend className="px-1 font-bold text-jaga-ink">{t("eta.ask")}</legend>
          <p className={hint}>{t("eta.askHint")}</p>
          <div className="grid grid-cols-2 gap-2">
            {ETA_BANDS.map((band) => (
              <button
                key={band}
                type="button"
                disabled={busy}
                aria-pressed={c.etaBand === band}
                onClick={() => {
                  setAsking(null);
                  actions.eta(c.sosId, band);
                }}
                data-eta={band}
                className={`${act} ${band === "unknown" ? "col-span-2" : ""}`}
              >
                {t(`eta.${band}`)}
              </button>
            ))}
          </div>
        </fieldset>
      )}
      {(state === "mine" || state === "held_by_other") && c.etaBand && !askEta && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="font-medium" data-eta-given={c.etaBand}>
            {t("eta.given", { band: t(`eta.${c.etaBand}`) })}
            {c.etaGivenAt
              ? ` · ${t("eta.givenAt", { time: bangkokClock.format(new Date(c.etaGivenAt)) })}`
              : ""}
          </p>
          {state === "mine" && (
            <button
              type="button"
              onClick={() => setAsking("eta")}
              className="inline-flex min-h-tap items-center font-medium underline"
            >
              {t("eta.change")}
            </button>
          )}
        </div>
      )}

      {state === "mine" && (
        <div className="flex flex-col gap-2">
          {step && (
            <button
              type="button"
              disabled={busy}
              onClick={() => actions.advance(c.sosId, step)}
              data-advance={step}
              className={buttonPrimary}
            >
              {busy ? t("act.working") : t(step === "en_route" ? "act.enRoute" : "act.onSite")}
            </button>
          )}
          {c.status === "on_site" && <p className={hint}>{t("case.closeNote")}</p>}
        </div>
      )}

      {open && state !== "held_by_other" && (
        <div className="grid grid-cols-2 gap-2">
          <a
            href={directionsHref(c.lat, c.lon)}
            target="_blank"
            rel="noreferrer"
            data-navigate="true"
            className={act}
          >
            <PinIcon size={20} />
            {t("act.navigate")}
          </a>
          {!phone && (
            <button
              type="button"
              disabled={busy}
              onClick={() => actions.phone(c.sosId)}
              data-show-phone="true"
              className={act}
            >
              <PhoneIcon size={20} />
              {t("act.showPhone")}
            </button>
          )}
          <div className="col-span-2 flex flex-col">
            <p className={hint}>{t("act.directionsWarning")}</p>
            <Link
              href="/map"
              className="inline-flex min-h-tap items-center self-start font-medium underline"
            >
              {t("act.jagaMap")}
            </Link>
          </div>
          <p className="col-span-2 flex flex-wrap items-center gap-x-3 tabular-nums">
            <span>{t("case.coordinates", { coords: coordsText(c.lat, c.lon) })}</span>
            <button
              type="button"
              onClick={() => void copy()}
              className="inline-flex min-h-tap items-center font-medium underline"
            >
              {copied ? t("case.copied") : t("case.copy")}
            </button>
          </p>
        </div>
      )}

      {open && phone && (
        <div className="flex flex-col gap-2 border-t border-jaga-line pt-3" data-phone="shown">
          {phone.number ? (
            <a href={`tel:${phone.number}`} className={`${buttonPrimary} gap-2 text-h3 font-bold`}>
              <PhoneIcon size={24} />
              {phone.number}
            </a>
          ) : (
            <p className="font-medium">{t("act.phoneNone")}</p>
          )}
          <p className={hint}>{t("act.phoneLogged")}</p>
        </div>
      )}

      {state === "mine" && (
        <div className="flex flex-col gap-2 border-t border-jaga-line pt-3">
          {asking !== "release" ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => setAsking("release")}
              data-release="true"
              className="inline-flex min-h-tap items-center self-start font-medium underline"
            >
              {t("act.release")}
            </button>
          ) : (
            <fieldset className="flex flex-col gap-2">
              <legend className="font-bold text-jaga-ink">{t("act.releaseWhy")}</legend>
              <p className={hint}>{t("act.releaseNote")}</p>
              <div className="grid grid-cols-2 gap-2">
                {RELEASE_REASONS.map((reason) => (
                  <button
                    key={reason}
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setAsking(null);
                      actions.release(c.sosId, reason);
                    }}
                    data-release-reason={reason}
                    className={act}
                  >
                    {t(`releaseReason.${reason}`)}
                  </button>
                ))}
              </div>
            </fieldset>
          )}
        </div>
      )}
    </article>
  );
}
