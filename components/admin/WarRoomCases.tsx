"use client";

import { useLocale, useTranslations } from "next-intl";
import { DualTime } from "@/components/admin/DualTime";
import { Chip, Flag, HourStrip, StateBadge } from "@/components/admin/WarRoomBits";
import {
  CheckIcon,
  ClockIcon,
  LifebuoyIcon,
  PhoneIcon,
  PinIcon,
  WaveIcon,
} from "@/components/icons";
import { Link } from "@/i18n/navigation";
import { buttonPrimary, card, hint, input, label } from "@/lib/ui";
import {
  caseState,
  directionsHref,
  hasNoUnit,
  triage,
  vulnerableKeys,
  waitingMinutes,
  type HistoryRow,
  type SosCase,
  type UnitOption,
} from "@/lib/war-room";

/**
 * The case board: who is waiting, for how long, and who (if anyone) is on the way.
 *
 * What an admin can do from here is spec 6.4: assign a case or hand it back, write down what they
 * did, and judge the spam flag. Nothing here can refuse, hide or delete a case (safety rule 1).
 * No phone number is in the board data: one is read for one case at a time, on the server,
 * through the logged reveal function (safety rule 5).
 */

export type CaseActions = {
  assign: (form: FormData) => Promise<void>;
  release: (form: FormData) => Promise<void>;
  note: (form: FormData) => Promise<void>;
  spam: (form: FormData) => Promise<void>;
};

/** What the page has already read for one case, because its panel is open in the address. */
export type CasePanels = {
  reveal: { caseId: string; phone: string | null } | null;
  assign: { caseId: string; units: UnitOption[] } | null;
  history: { caseId: string; rows: HistoryRow[] } | null;
  /** A form that needs nothing from the server to open. */
  form: { kind: "release" | "note" | "spam"; caseId: string } | null;
};

type Shared = CasePanels & {
  now: number;
  unclaimedMinutes: number;
  /** Where the panel links point. Null on the example page, where the buttons sit idle. */
  path: string | null;
  actions: CaseActions | null;
};

type Props = Shared & { cases: SosCase[] };

const shortId = (id: string) => id.slice(0, 8);

export function WarRoomCases({ cases, ...shared }: Props) {
  const t = useTranslations("warRoom");
  const bands = triage(cases, shared.now, shared.unclaimedMinutes);
  const needAnswer = [...bands.overdue, ...bands.waiting];

  return (
    <div className="flex flex-col gap-5">
      <section className={card}>
        <HourStrip cases={cases} now={shared.now} />
      </section>

      <Band
        title={t("band.needAnswer", { count: needAnswer.length })}
        note={t("band.needAnswerNote", { minutes: shared.unclaimedMinutes })}
        cases={needAnswer}
        empty={t("band.noneWaiting")}
        {...shared}
      />
      <Band
        title={t("band.working", { count: bands.working.length })}
        note={t("band.workingNote")}
        cases={bands.working}
        empty={t("band.noneWorking")}
        {...shared}
      />
      <Band
        title={t("band.closed", { count: bands.closed.length })}
        note={t("band.closedNote")}
        cases={bands.closed}
        empty={t("band.noneClosed")}
        foldAway
        {...shared}
      />
    </div>
  );
}

function Band({
  title,
  note,
  cases,
  empty,
  foldAway = false,
  ...shared
}: Shared & {
  title: string;
  note: string;
  cases: SosCase[];
  empty: string;
  foldAway?: boolean;
}) {
  // One column on a phone, two once there is room: the board is read on a laptop as well.
  const list = (
    <div className="grid gap-4 lg:grid-cols-2">
      {cases.map((c) => (
        <CaseCard key={c.id} c={c} {...shared} />
      ))}
    </div>
  );
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-h3 font-bold text-jaga-ink">{title}</h2>
        <p className={hint}>{note}</p>
      </div>
      {cases.length === 0 ? (
        <p className={hint}>{empty}</p>
      ) : foldAway ? (
        <details>
          <summary className="min-h-tap cursor-pointer py-2 underline">{title}</summary>
          <div className="pt-3">{list}</div>
        </details>
      ) : (
        list
      )}
    </section>
  );
}

function CaseCard({
  c,
  now,
  unclaimedMinutes,
  path,
  actions,
  reveal,
  assign,
  history,
  form,
}: Shared & { c: SosCase }) {
  const t = useTranslations("warRoom");
  const tSos = useTranslations("sos");
  const tReport = useTranslations("report");
  const state = caseState(c, now, unclaimedMinutes);
  const link = (params: Record<string, string>) =>
    path ? `${path}?${new URLSearchParams({ view: "cases", ...params })}` : null;
  const locale = useLocale();
  const thaiLine = [c.tambonTh, c.districtTh, c.provinceTh].filter(Boolean).join(" · ");
  // The Thai name is the one said out loud on the phone, so it stays; a reader of English or
  // Malay gets the tambon's Latin spelling beside it.
  const place = locale === "th" || !c.tambonEn ? thaiLine : `${thaiLine} (${c.tambonEn})`;
  const vulnerable = vulnerableKeys(c.vulnerable);
  const mine = (kind: string) => form?.kind === kind && form.caseId === c.id;

  return (
    <article
      className={`flex flex-col gap-3 rounded-2xl bg-jaga-surface p-4 ${
        state === "overdue" ? "border-2 border-sos" : "border border-jaga-line"
      }`}
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <StateBadge
          state={state}
          minutes={waitingMinutes(c, now)}
          unitName={c.unitName ?? c.orgName}
        />
        <span className={`${hint} tabular-nums`}>#{shortId(c.id)}</span>
      </header>

      <p className="font-bold text-jaga-ink">{place || t("case.noArea")}</p>
      {c.locationText && <p className={hint}>{t("case.typedPlace", { text: c.locationText })}</p>}
      <p className={hint}>
        {t("case.sentAt")} <DualTime iso={c.createdAt} bangkokLabel={t("bangkok")} />
        {c.accuracyM != null ? ` · ${t("case.accuracy", { m: Math.round(c.accuracyM) })}` : ""}
      </p>

      <div className="flex flex-wrap gap-2">
        {c.peopleCount != null && <Chip strong>{t("case.people", { count: c.peopleCount })}</Chip>}
        {c.depth && (
          <Chip strong>
            <WaveIcon size={18} />
            {tReport(`depths.${c.depth}` as "depths.knee")}
          </Chip>
        )}
        {vulnerable.map((k) => (
          <Chip key={k} strong>
            {tSos.has(`vulnerable.${k}`) ? tSos(`vulnerable.${k}`) : k}
          </Chip>
        ))}
        {c.onBehalf && <Chip>{t("case.onBehalf")}</Chip>}
        <Chip>{c.hasPhone ? t("case.hasPhone") : t("case.noPhone")}</Chip>
        {c.photos > 0 && <Chip>{t("case.photos", { count: c.photos })}</Chip>}
        {c.hasVoice && <Chip>{t("case.voice")}</Chip>}
        {c.batteryPct != null && <Chip>{t("case.battery", { pct: c.batteryPct })}</Chip>}
        {c.mergedIn > 0 && <Chip strong>{t("case.merged", { count: c.mergedIn })}</Chip>}
      </div>

      {c.injuries && <p className="font-medium">{t("case.injuries", { text: c.injuries })}</p>}
      {c.note && <p>{t("case.said", { text: c.note })}</p>}
      {c.onBehalfNote && <p className={hint}>{c.onBehalfNote}</p>}

      {hasNoUnit(c) && <Flag>{t("case.noUnit")}</Flag>}
      {c.suspectedSpam && <Flag>{t("case.spamFlag")}</Flag>}
      {c.possibleDuplicateOf && (
        <Flag>{t("case.possibleDuplicate", { id: shortId(c.possibleDuplicateOf) })}</Flag>
      )}

      {/* Two buttons a row on a phone, in a line once there is room. */}
      <div className="grid grid-cols-2 gap-2 lg:flex lg:flex-wrap">
        <Act
          href={link({ reveal: c.id })}
          label={t("case.showPhone")}
          icon={<PhoneIcon size={20} />}
        />
        {c.unitId ? (
          <Act
            href={link({ release: c.id })}
            label={t("case.handBack")}
            icon={<LifebuoyIcon size={20} />}
          />
        ) : (
          <Act
            href={link({ assign: c.id })}
            label={t("case.assign")}
            icon={<LifebuoyIcon size={20} />}
          />
        )}
        <Act href={link({ note: c.id })} label={t("case.addNote")} icon={<ClockIcon size={20} />} />
        {c.lat != null && c.lon != null && (
          <a
            href={directionsHref(c.lat, c.lon)}
            target="_blank"
            rel="noreferrer"
            className={actClass}
          >
            <PinIcon size={20} />
            {t("case.directions")}
          </a>
        )}
        {c.suspectedSpam && (
          <Act
            href={link({ spam: c.id })}
            label={t("case.judgeSpam")}
            icon={<CheckIcon size={20} />}
          />
        )}
        <Act href={link({ case: c.id })} label={t("case.history")} />
      </div>

      {reveal?.caseId === c.id && (
        <div className="flex flex-col gap-2 border-t border-jaga-line pt-3">
          {reveal.phone ? (
            <>
              <a href={`tel:${reveal.phone}`} className="min-h-tap text-h3 font-bold underline">
                {reveal.phone}
              </a>
              <p className={hint}>{t("case.phoneLogged")}</p>
            </>
          ) : (
            <p className="font-medium">{t("case.phoneNone")}</p>
          )}
        </div>
      )}

      {assign?.caseId === c.id && (
        <div className="flex flex-col gap-3 border-t border-jaga-line pt-3">
          <h3 className="font-bold text-jaga-ink">{t("assign.title")}</h3>
          <p className={hint}>{t("assign.note")}</p>
          {assign.units.length === 0 && <p className="font-medium">{t("assign.noUnits")}</p>}
          {assign.units.map((u) => (
            <form
              key={u.id}
              action={actions?.assign}
              className="flex flex-col gap-2 rounded-xl border border-jaga-line p-3"
            >
              <input type="hidden" name="sos" value={c.id} />
              <input type="hidden" name="unit" value={u.id} />
              <p className="font-bold">
                {u.orgName} · {u.unitName}
              </p>
              <p className={hint}>
                {u.capabilities
                  .map((cap) => (t.has(`capability.${cap}`) ? t(`capability.${cap}`) : cap))
                  .join(", ")}
                {" · "}
                {t("assign.openCases", { count: u.openCases })}
              </p>
              <label className={label} htmlFor={`assign-note-${c.id}-${u.id}`}>
                {t("assign.what")}
              </label>
              <input
                id={`assign-note-${c.id}-${u.id}`}
                name="note"
                maxLength={500}
                className={input}
              />
              <button type="submit" className={buttonPrimary} disabled={!actions}>
                {t("assign.confirm", { unit: u.unitName })}
              </button>
            </form>
          ))}
        </div>
      )}

      {mine("release") && (
        <form
          action={actions?.release}
          className="flex flex-col gap-2 border-t border-jaga-line pt-3"
        >
          <input type="hidden" name="sos" value={c.id} />
          <label className={label} htmlFor={`release-${c.id}`}>
            {t("release.why")}
          </label>
          <p className={hint}>{t("release.note")}</p>
          <input id={`release-${c.id}`} name="reason" required maxLength={500} className={input} />
          <button type="submit" className={buttonPrimary} disabled={!actions}>
            {t("release.confirm")}
          </button>
        </form>
      )}

      {mine("note") && (
        <form action={actions?.note} className="flex flex-col gap-2 border-t border-jaga-line pt-3">
          <input type="hidden" name="sos" value={c.id} />
          <label className={label} htmlFor={`note-${c.id}`}>
            {t("note.what")}
          </label>
          <p className={hint}>{t("note.note")}</p>
          <input id={`note-${c.id}`} name="note" required maxLength={500} className={input} />
          <button type="submit" className={buttonPrimary} disabled={!actions}>
            {t("note.confirm")}
          </button>
        </form>
      )}

      {mine("spam") && (
        <form action={actions?.spam} className="flex flex-col gap-2 border-t border-jaga-line pt-3">
          <input type="hidden" name="sos" value={c.id} />
          <input type="hidden" name="spam" value={c.suspectedSpam ? "no" : "yes"} />
          <p className="font-medium">
            {c.suspectedSpam ? t("spam.dismissTitle") : t("spam.flagTitle")}
          </p>
          <p className={hint}>{t("spam.note")}</p>
          <label className={label} htmlFor={`spam-${c.id}`}>
            {t("spam.why")}
          </label>
          <input id={`spam-${c.id}`} name="reason" maxLength={500} className={input} />
          <button type="submit" className={buttonPrimary} disabled={!actions}>
            {c.suspectedSpam ? t("spam.dismissConfirm") : t("spam.flagConfirm")}
          </button>
        </form>
      )}

      {history?.caseId === c.id && (
        <ol className="flex flex-col gap-2 border-t border-jaga-line pt-3">
          {history.rows.map((r, i) => (
            <li key={i} className="text-small">
              <DualTime iso={r.at} bangkokLabel={t("bangkok")} />{" "}
              <b>{t.has(`event.${r.event}`) ? t(`event.${r.event}`) : r.event}</b>
              {r.unitName ? ` · ${r.unitName}` : ""}
              {r.actorName ? ` · ${r.actorName}` : ""}
              {r.note ? ` · ${r.note}` : ""}
            </li>
          ))}
          {history.rows.length === 0 && <li className={hint}>{t("case.noHistory")}</li>}
        </ol>
      )}
    </article>
  );
}

const actClass =
  "inline-flex min-h-tap items-center justify-center gap-2 rounded-xl border-2 border-jaga-edge bg-jaga-surface px-3 py-2 text-small font-medium text-jaga-ink";

function Act({
  href,
  label: text,
  icon,
}: {
  href: string | null;
  label: string;
  icon?: React.ReactNode;
}) {
  if (!href) {
    return (
      <span className={`${actClass} opacity-50`} aria-disabled="true">
        {icon}
        {text}
      </span>
    );
  }
  return (
    <Link href={href} prefetch={false} className={actClass}>
      {icon}
      {text}
    </Link>
  );
}
