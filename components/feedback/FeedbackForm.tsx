"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { FaceIcon, HouseIcon, SendIcon } from "@/components/icons";
import { Link } from "@/i18n/navigation";
import type { Area } from "@/lib/area";
import {
  canBePublic,
  EMPTY_FEEDBACK,
  type FeedbackInput,
  hasAnswer,
  IMPROVE,
  LIKED,
  type Moment,
  RATINGS,
  type Rating,
  toggle,
} from "@/lib/feedback";
import { rememberSent } from "@/lib/feedback-store";
import type { MyPlaces } from "@/lib/me";
import { useStored } from "@/lib/phone-store";
import { enqueue } from "@/lib/queue";
import { INSTALL_KEY } from "@/lib/usage-beacon";
import { readAgent } from "@/lib/usage";
import {
  buttonPrimary,
  buttonSecondary,
  card,
  checkBox,
  checkRow,
  errorNotice,
  hint,
  input,
  label,
  notice,
} from "@/lib/ui";

type State = "ready" | "sending" | "sent" | "limited" | "queued" | "failed";

/**
 * The four-step form of spec 17, approved by the owner on 16 Oct 2026: a rating as faces, what
 * you love, what should be better, and then - separately - the two consents.
 *
 * **Nothing is required.** There is no validation to fail: the send button is live from the first
 * render, and a form with nothing in it says so in one line instead of marking fields red. The
 * two ticks at the end are deliberately apart from each other and from sending: agreeing to be
 * contacted is not agreeing to be published, and neither is a condition of being heard.
 *
 * Offline it joins the same queue as a report (safety rule 7), behind any SOS. A rating must
 * never be the reason a request for help waits, which is why it is enqueued last and retried
 * with everything else rather than on a clock of its own.
 */
export function FeedbackForm({
  screen = "/feedback",
  moment = "menu",
  sos = null,
  onSent,
}: {
  /** The screen the feedback is about (lib/feedback.ts `screenCode`). */
  screen?: string;
  moment?: Moment;
  /** The case a post-request rating followed. Admins only; it never reaches the public page. */
  sos?: string | null;
  onSent?: () => void;
}) {
  const t = useTranslations("feedback");
  const locale = useLocale();
  const [form, setForm] = useState<FeedbackInput>(EMPTY_FEEDBACK);
  const [state, setState] = useState<State>("ready");
  const [showNothing, setShowNothing] = useState(false);
  const [wasPublic, setWasPublic] = useState(false);
  const area = useStored<Area>("area");
  const me = useStored<MyPlaces>("me");

  const set = <K extends keyof FeedbackInput>(key: K, value: FeedbackInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }));
  const publicOffered = canBePublic(form);

  async function send() {
    if (!hasAnswer(form)) {
      setShowNothing(true);
      return;
    }
    setShowNothing(false);
    setState("sending");
    // The district the person chose, and nothing finer: never the tambon, never GPS (spec 17).
    const tambon = area?.code ?? (me?.signedIn ? me.home?.code : null) ?? null;
    const body = {
      rating: form.rating,
      liked: form.liked,
      likedNote: form.likedNote.trim() || null,
      improve: form.improve,
      improveNote: form.improveNote.trim() || null,
      screen,
      locale,
      deviceKind: readAgent(navigator.userAgent, navigator.maxTouchPoints ?? 0).device,
      district: tambon ? tambon.slice(0, 4) : null,
      moment,
      sos,
      deviceId: deviceId(),
      contactOk: form.contactOk && form.contact.trim() !== "",
      contact: form.contact.trim() || null,
      // A tick with no words behind it publishes nothing, so it is not sent either.
      publicOk: form.publicOk && publicOffered,
      displayName: form.displayName.trim() || null,
    };
    setWasPublic(body.publicOk);
    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
      });
      if (!response.ok) throw new Error(String(response.status));
      const answer = (await response.json()) as {
        id: string | null;
        key: string | null;
        limited: boolean;
      };
      if (answer.limited) {
        setState("limited");
        return;
      }
      if (answer.id) rememberSent({ id: answer.id, key: answer.key, publicOk: body.publicOk });
      setState("sent");
      onSent?.();
    } catch {
      const key = await enqueue("feedback", "/api/feedback", body);
      setState(key ? "queued" : "failed");
      onSent?.();
    }
  }

  if (state === "sent" || state === "queued" || state === "limited") {
    const titles = { sent: "sentTitle", queued: "queuedTitle", limited: "limitedTitle" } as const;
    const bodies = { sent: "sentBody", queued: "queuedBody", limited: "limitedBody" } as const;
    return (
      <section className="flex flex-col gap-4" data-feedback-state={state}>
        <div className={notice}>
          <h2 className="text-h3 font-bold text-jaga-ink">{t(`form.${titles[state]}`)}</h2>
          <p className="mt-2">{t(`form.${bodies[state]}`)}</p>
          {state === "sent" && wasPublic && <p className="mt-2">{t("form.sentPublic")}</p>}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={() => {
              setForm(EMPTY_FEEDBACK);
              setState("ready");
            }}
            className={buttonSecondary}
          >
            {t("form.another")}
          </button>
          <Link href="/" className={buttonSecondary}>
            <HouseIcon size={22} />
            {t("home")}
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-4" data-feedback-state={state}>
      {/* 1. How is Jaga for you: a face, a word and the number, never colour alone. */}
      <fieldset className={card} data-feedback-step="rating">
        <legend className={`${label} text-h3 text-jaga-ink`}>{t("form.ratingTitle")}</legend>
        <p className={hint}>{t("form.ratingHint")}</p>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("form.ratingTitle")}>
          {RATINGS.map((n) => {
            const chosen = form.rating === n;
            return (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={chosen}
                data-feedback-rating={n}
                onClick={() => set("rating", chosen ? null : (n as Rating))}
                className={`flex min-h-tap min-w-[4.5rem] flex-1 flex-col items-center gap-1 rounded-xl border-2 px-2 py-3 ${
                  chosen
                    ? "border-jaga-teal-ink bg-jaga-teal-ink/10 font-bold text-jaga-ink"
                    : "border-jaga-line bg-jaga-surface text-jaga-text"
                }`}
              >
                <FaceIcon mood={n} size={34} />
                <span className="text-small leading-tight">{t(`words.${n}`)}</span>
                <span className={hint}>{n}</span>
              </button>
            );
          })}
        </div>
      </fieldset>

      {/* 2. What you love: chips, then a box of their own words. */}
      <Chips
        name="liked"
        codes={LIKED}
        title={t("form.likedTitle")}
        choiceHint={t("form.likedHint")}
        noteLabel={t("form.likedNote")}
        notePlaceholder={t("form.likedNotePlaceholder")}
        chosen={form.liked}
        onToggle={(code) => set("liked", toggle(form.liked, code))}
        note={form.likedNote}
        onNote={(value) => set("likedNote", value)}
        word={(code) => t(`chips.liked.${code}`)}
      />

      {/* 3. What should be better. The weak points are named, both directions of warning too. */}
      <Chips
        name="improve"
        codes={IMPROVE}
        title={t("form.improveTitle")}
        choiceHint={t("form.improveHint")}
        noteLabel={t("form.improveNote")}
        notePlaceholder={t("form.improveNotePlaceholder")}
        chosen={form.improve}
        onToggle={(code) => set("improve", toggle(form.improve, code))}
        note={form.improveNote}
        onNote={(value) => set("improveNote", value)}
        word={(code) => t(`chips.improve.${code}`)}
      />

      {/* 4. Before you send: two consents, each on its own, neither needed to be heard. */}
      <fieldset className={card} data-feedback-step="before">
        <legend className={`${label} text-h3 text-jaga-ink`}>{t("form.beforeTitle")}</legend>

        <label className={checkRow}>
          <input
            type="checkbox"
            checked={form.contactOk}
            onChange={(event) => set("contactOk", event.target.checked)}
            className={checkBox}
            data-feedback-contact-ok="true"
          />
          <span>
            <span className={label}>{t("form.contactOk")}</span>
            <span className={`block ${hint}`}>{t("form.contactHint")}</span>
          </span>
        </label>
        {form.contactOk && (
          <label className="flex flex-col gap-2">
            <span className={label}>{t("form.contactLabel")}</span>
            <input
              value={form.contact}
              onChange={(event) => set("contact", event.target.value)}
              maxLength={200}
              className={input}
              data-feedback-contact="true"
            />
          </label>
        )}

        <label className={checkRow}>
          <input
            type="checkbox"
            checked={form.publicOk && publicOffered}
            disabled={!publicOffered}
            onChange={(event) => set("publicOk", event.target.checked)}
            className={checkBox}
            data-feedback-public-ok="true"
          />
          <span>
            <span className={label}>{t("form.publicOk")}</span>
            <span className={`block ${hint}`}>
              {publicOffered ? t("form.publicHint") : t("form.publicNeedsWords")}
            </span>
          </span>
        </label>
        {form.publicOk && publicOffered && (
          <label className="flex flex-col gap-2">
            <span className={label}>{t("form.displayName")}</span>
            <input
              value={form.displayName}
              onChange={(event) => set("displayName", event.target.value)}
              maxLength={40}
              placeholder={t("form.anonymous")}
              className={input}
              data-feedback-name="true"
            />
            <span className={hint}>{t("form.displayNameHint")}</span>
          </label>
        )}
      </fieldset>

      {showNothing && (
        <p role="status" className={notice}>
          {t("form.nothing")}
        </p>
      )}
      {state === "failed" && (
        <p role="alert" className={errorNotice}>
          {t("form.failed")}
        </p>
      )}
      <button
        type="button"
        onClick={() => void send()}
        disabled={state === "sending"}
        data-feedback-send="true"
        className={buttonPrimary}
      >
        <SendIcon size={22} />
        {state === "sending" ? t("form.sending") : t("form.send")}
      </button>
    </section>
  );
}

/** One of the two chip lists, with its own box of free text under it. */
function Chips({
  name,
  codes,
  title,
  choiceHint,
  noteLabel,
  notePlaceholder,
  chosen,
  onToggle,
  note,
  onNote,
  word,
}: {
  name: string;
  codes: readonly string[];
  title: string;
  choiceHint: string;
  noteLabel: string;
  notePlaceholder: string;
  chosen: string[];
  onToggle: (code: string) => void;
  note: string;
  onNote: (value: string) => void;
  word: (code: string) => string;
}) {
  return (
    <fieldset className={card} data-feedback-step={name}>
      <legend className={`${label} text-h3 text-jaga-ink`}>{title}</legend>
      <p className={hint}>{choiceHint}</p>
      {/* Wrapped, not a row: ten chips in Thai do not fit across 360 px (CLAUDE.md). */}
      <div className="flex flex-wrap gap-2">
        {codes.map((code) => {
          const on = chosen.includes(code);
          return (
            <button
              key={code}
              type="button"
              aria-pressed={on}
              data-feedback-chip={`${name}:${code}`}
              onClick={() => onToggle(code)}
              className={`inline-flex min-h-tap items-center rounded-full border-2 px-4 py-2 text-start ${
                on
                  ? "border-jaga-teal-ink bg-jaga-teal-ink/10 font-bold text-jaga-ink"
                  : "border-jaga-line bg-jaga-surface text-jaga-text"
              }`}
            >
              {word(code)}
            </button>
          );
        })}
      </div>
      <label className="flex flex-col gap-2">
        <span className={label}>{noteLabel}</span>
        <textarea
          value={note}
          onChange={(event) => onNote(event.target.value)}
          rows={3}
          maxLength={2000}
          placeholder={notePlaceholder}
          className={input}
          data-feedback-note={name}
        />
      </label>
    </fieldset>
  );
}

/** The install code the usage counter already keeps, so the daily limit knows one phone twice. */
function deviceId(): string | null {
  try {
    return window.localStorage.getItem(INSTALL_KEY);
  } catch {
    return null;
  }
}
