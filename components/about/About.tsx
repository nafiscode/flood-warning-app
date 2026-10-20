/* eslint-disable @next/next/no-img-element -- small static marks, sized in the markup */
import { useTranslations } from "next-intl";
import {
  CheckIcon,
  ForwardIcon,
  MapIcon,
  MessageIcon,
  QuestionIcon,
  ShieldIcon,
} from "@/components/icons";
import { Link } from "@/i18n/navigation";
import {
  ABOUT_LINKS,
  CAREER_STEPS,
  CREDENTIAL_GROUPS,
  CREDENTIAL_ITEMS,
  PORTRAIT_READY,
  SCOPE_POINTS,
  SCOPE_PARTS,
  TRUST_POINTS,
  type CareerStep,
  type CredentialGroup,
  type ScopePart,
} from "@/lib/about";
import { buttonSecondary } from "@/lib/ui";
import { ABOUT_ICONS } from "./icons";
import { Journey } from "./Journey";
import { Portrait } from "./Portrait";

/** The headline numbers from the owner's own career record, not from Jaga's analysis. */
const STATS = ["years", "flood", "reservoirs", "forecast", "theos"] as const;

/**
 * "Who built Jaga" (the owner's request, 20 Oct 2026): the founder and developer, for the reader
 * who wants to know whether a one-person flood-warning app can be trusted, and for the reader who
 * knows him personally and has never seen the professional side.
 *
 * The shape of the page is the argument. A hero that names him, then **why**, then the career as
 * a line where every step carries the part of Jaga it produced - so by the end the app reads as
 * the obvious thing for this person to have built rather than a surprise. Then the part that
 * makes the rest believable: what he did *not* do. Then what to trust and what not to, then the
 * record, then three addresses to go and check.
 *
 * Nothing runs in the browser and nothing is downloaded except the portrait, if there is one, so
 * the page costs one small HTML file on a slow connection. The project address is read from the
 * environment at render time (never written into a file), and no personal phone number appears
 * anywhere on it - safety rule 5 covers the owner's own number too, and the page says so.
 *
 * @param showPortrait overrides `PORTRAIT_READY`, which is the real switch; the review page
 *   uses it to show the slot both ways before a photo is chosen.
 */
export function About({ showPortrait = PORTRAIT_READY }: { showPortrait?: boolean }) {
  const t = useTranslations("about");
  const contact = process.env.CONTACT_EMAIL?.trim();
  return (
    <div className="flex flex-col gap-8" data-about>
      {/* Who, in one breath: the face, the name in both scripts, the role, and the arrangement. */}
      <section className="flex flex-col gap-5 rounded-3xl bg-jaga-slate px-5 py-7 text-white lg:px-10 lg:py-10">
        <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center">
          <Portrait show={showPortrait} cut />
          <div className="flex min-w-0 flex-col gap-2">
            <h1 className="text-h2 font-bold leading-tight lg:text-h1">{t("title")}</h1>
            <p className="text-h3 font-bold leading-snug">
              {t("nameThai")} <span className="font-medium text-white/80">({t("name")})</span>
            </p>
            <p className="text-small text-white/85">{t("role")}</p>
          </div>
        </div>
        <p className="text-body text-white/90">{t("lead")}</p>
        <p className="text-small text-white/80">{t("audience")}</p>
        <ul className="flex flex-wrap gap-2" data-about-stats>
          {STATS.map((key) => (
            <li
              key={key}
              className="rounded-full bg-white/10 px-3 py-1 text-small font-medium ring-1 ring-white/20"
            >
              {t(`stats.${key}`)}
            </li>
          ))}
        </ul>
      </section>

      {/* Why, before any credential: the reason is the only part a CV cannot carry. */}
      <section className="flex flex-col gap-3" aria-labelledby="about-why" id="why">
        <h2 id="about-why" className="text-h3 font-bold text-jaga-ink">
          {t("why.title")}
        </h2>
        {(["p1", "p2", "p3", "p4"] as const).map((key) => (
          <p key={key} className="text-jaga-text">
            {t(`why.${key}`)}
          </p>
        ))}
      </section>

      {/*
        The whole shape in one picture before the record of it: three industries in a decade,
        from the owner's own portfolio. The cards below then say what each move produced, so the
        argument is met twice - once as a picture, once as a record.
      */}
      <Journey />

      {/*
        The career as a line, oldest first, because the direction of travel is the point. Every
        step ends on the part of Jaga that came out of it, so the reader who knows him personally
        arrives at the app as a conclusion rather than a surprise.
      */}
      <section className="flex flex-col gap-4" aria-labelledby="about-road" id="road">
        <h2 id="about-road" className="text-h3 font-bold text-jaga-ink">
          {t("road.title")}
        </h2>
        <p className="text-jaga-text">{t("road.lead")}</p>
        <ol className="flex flex-col gap-4">
          {CAREER_STEPS.map((step, i) => (
            <StepCard key={step.key} step={step} n={i + 1} />
          ))}
        </ol>
        <p className="text-small text-jaga-text-2">{t("road.marks")}</p>
      </section>

      {/* The honest split. A trust page that only boasts is not one. */}
      <section className="flex flex-col gap-4" aria-labelledby="about-scope" id="scope">
        <h2 id="about-scope" className="text-h3 font-bold text-jaga-ink">
          {t("scope.title")}
        </h2>
        <p className="text-jaga-text">{t("scope.lead")}</p>
        <ul className="grid gap-3 lg:grid-cols-3">
          {SCOPE_PARTS.map((part) => (
            <ScopeCard key={part} part={part} />
          ))}
        </ul>
        <p>
          <Link
            href="/how-it-works#credits"
            prefetch={false}
            className="inline-flex min-h-tap items-center font-medium text-jaga-ink underline"
          >
            {t("scope.credits")}
          </Link>
        </p>
      </section>

      {/* The promises, each with its limit in the same card. */}
      <section className="flex flex-col gap-3" aria-labelledby="about-trust" id="trust">
        <h2 id="about-trust" className="text-h3 font-bold text-jaga-ink">
          {t("trust.title")}
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {TRUST_POINTS.map((key) => (
            <li
              key={key}
              data-about-trust={key}
              className="flex min-w-0 gap-3 rounded-2xl border border-jaga-line bg-jaga-surface p-4"
            >
              <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl bg-jaga-ground text-jaga-teal-ink">
                <ShieldIcon size={20} />
              </span>
              <span className="flex min-w-0 flex-col gap-1">
                <span className="font-bold leading-snug text-jaga-ink">
                  {t(`trust.points.${key}.title`)}
                </span>
                <span className="text-jaga-text">{t(`trust.points.${key}.text`)}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* The record, compact: what a reader can look up elsewhere. */}
      <section className="flex flex-col gap-4" aria-labelledby="about-record" id="record">
        <h2 id="about-record" className="text-h3 font-bold text-jaga-ink">
          {t("credentials.title")}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {CREDENTIAL_GROUPS.map((group) => (
            <CredentialCard key={group} group={group} />
          ))}
        </div>
        <p className="text-jaga-text">{t("credentials.malayNote")}</p>
      </section>

      {/* Three addresses, and the project's own. Never a phone number, and the page says why. */}
      <section
        className="flex flex-col gap-4 rounded-3xl border border-jaga-line bg-jaga-surface p-5 lg:p-8"
        aria-labelledby="about-check"
        id="check"
      >
        <h2 id="about-check" className="text-h3 font-bold text-jaga-ink">
          {t("check.title")}
        </h2>
        <p className="text-jaga-text">{t("check.lead")}</p>
        <ul className="grid gap-3 sm:grid-cols-2">
          {ABOUT_LINKS.map((link) => (
            <li key={link.key}>
              <a
                href={link.href}
                target="_blank"
                rel={`noopener noreferrer external${link.me ? " me" : ""}`}
                data-about-link={link.key}
                className="flex h-full min-h-tap flex-col gap-1 rounded-2xl border border-jaga-line bg-jaga-ground p-4 hover:border-jaga-teal-ink"
              >
                <span className="font-bold text-jaga-ink underline">
                  {t(`check.links.${link.key}.title`)}
                </span>
                <span className="text-small text-jaga-text">
                  {t(`check.links.${link.key}.text`)}
                </span>
              </a>
            </li>
          ))}
        </ul>
        {contact && (
          <p className="flex flex-col gap-1">
            <a
              href={`mailto:${contact}`}
              className="inline-flex min-h-tap items-center gap-2 font-bold text-jaga-ink underline"
            >
              <MessageIcon size={20} />
              {t("check.emailTitle")}
            </a>
            <span className="text-small text-jaga-text">{t("check.emailText")}</span>
          </p>
        )}
        <p className="text-small text-jaga-text-2">{t("check.noPhone")}</p>
      </section>

      {/* Out of here, back to the app. The page about the person is the least important one. */}
      <section className="flex flex-col gap-4 rounded-3xl bg-jaga-slate px-5 py-6 text-white lg:px-8">
        <h2 className="text-h3 font-bold">{t("closing.title")}</h2>
        <p className="text-white/90">{t("closing.text")}</p>
        <div className="grid gap-2 sm:grid-cols-3">
          <Link href="/how-it-works" prefetch={false} className={buttonSecondary}>
            <ForwardIcon size={22} className="rtl:-scale-x-100" />
            {t("closing.how")}
          </Link>
          <Link href="/features" prefetch={false} className={buttonSecondary}>
            <QuestionIcon size={22} />
            {t("closing.features")}
          </Link>
          <Link href="/map" prefetch={false} className={buttonSecondary}>
            <MapIcon size={22} />
            {t("closing.map")}
          </Link>
        </div>
      </section>
    </div>
  );
}

/**
 * One step on the way to Jaga: when, what the job was, who it was for, what was done, and then -
 * set apart in the brand teal - the part of Jaga that came out of it. That last line is the whole
 * purpose of the card, so it is the only thing on the page drawn in a colour.
 */
function StepCard({ step, n }: { step: CareerStep; n: number }) {
  const t = useTranslations("about");
  const base = `road.steps.${step.key}`;
  const what = Array.from({ length: step.what }, (_, i) => t(`${base}.what.${i + 1}`));
  return (
    <li
      id={`step-${step.key}`}
      data-about-step={step.key}
      className="flex scroll-mt-28 flex-col gap-3 rounded-3xl border border-jaga-line bg-jaga-surface p-5 lg:p-7"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-xl bg-jaga-ground text-jaga-teal-ink">
          {ABOUT_ICONS[step.icon](22)}
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-small font-medium text-jaga-text-2">
            {n}. {t(`${base}.years`)}
          </p>
          <h3 className="text-h3 font-bold leading-snug text-jaga-ink">{t(`${base}.title`)}</h3>
          <p className="text-jaga-text">{t(`${base}.where`)}</p>
        </div>
        {/*
          The employer's own mark, where there is one. The files are white on transparent, so it
          sits on a slate chip rather than on the card, which is white in daylight. It is a
          picture of a name and nothing more: no link, and hidden from a screen reader, because
          the employer is already written beside it in words.
        */}
        {step.logo && (
          <span
            data-about-logo={step.logo}
            className="ms-auto hidden h-10 shrink-0 items-center rounded-xl bg-jaga-slate px-3 sm:flex"
          >
            <img
              src={`/about/logos/${step.logo}.png`}
              alt=""
              aria-hidden="true"
              height={20}
              className="h-5 w-auto opacity-90"
              loading="lazy"
              decoding="async"
            />
          </span>
        )}
      </div>

      <ul className="flex flex-col gap-2">
        {what.map((line) => (
          <li key={line} className="flex items-start gap-2 text-jaga-text">
            <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-jaga-teal-ink text-jaga-surface">
              <CheckIcon size={14} />
            </span>
            {line}
          </li>
        ))}
      </ul>

      <p className="flex flex-col gap-1 rounded-2xl border-s-4 border-jaga-teal-ink bg-jaga-ground px-4 py-3">
        {/* No `uppercase`: the label names Jaga, and the brand is never set as JAGA. */}
        <span className="text-small font-bold tracking-wide text-jaga-teal-ink">
          {t("road.gaveLabel")}
        </span>
        <span className="text-jaga-text">{t(`${base}.gave`)}</span>
      </p>
    </li>
  );
}

/** Mine / built with help / not mine at all - the three columns, in that order. */
function ScopeCard({ part }: { part: ScopePart }) {
  const t = useTranslations("about");
  const points = Array.from({ length: SCOPE_POINTS[part] }, (_, i) =>
    t(`scope.${part}.points.${i + 1}`),
  );
  return (
    <li
      data-about-scope={part}
      className="flex flex-col gap-3 rounded-2xl border border-jaga-line bg-jaga-surface p-5"
    >
      <h3 className="text-h3 font-bold text-jaga-ink">{t(`scope.${part}.title`)}</h3>
      <ul className="flex flex-col gap-2">
        {points.map((point) => (
          <li key={point} className="flex items-start gap-2 text-jaga-text">
            <span className="mt-0.5 size-2 shrink-0 translate-y-2 rounded-full bg-jaga-teal-ink" />
            {point}
          </li>
        ))}
      </ul>
    </li>
  );
}

/** Education, membership, training, languages: plain lists, nothing to interpret. */
function CredentialCard({ group }: { group: CredentialGroup }) {
  const t = useTranslations("about");
  const items = Array.from({ length: CREDENTIAL_ITEMS[group] }, (_, i) =>
    t(`credentials.${group}.items.${i + 1}`),
  );
  return (
    <section
      data-about-credential={group}
      className="flex flex-col gap-2 rounded-2xl border border-jaga-line bg-jaga-surface p-4"
      aria-labelledby={`cred-${group}`}
    >
      <h3 id={`cred-${group}`} className="font-bold text-jaga-ink">
        {t(`credentials.${group}.title`)}
      </h3>
      <ul className="flex flex-col gap-1">
        {items.map((item) => (
          <li key={item} className="text-jaga-text">
            {item}
          </li>
        ))}
      </ul>
    </section>
  );
}
