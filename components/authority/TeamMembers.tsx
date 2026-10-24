"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CheckIcon, CrossIcon, PersonIcon, ShareIcon, TrashIcon } from "@/components/icons";
import { routing } from "@/i18n/routing";
import { BANGKOK_DATE_TIME } from "@/lib/time";
import type { OwnedTeam } from "@/lib/unit-team";
import {
  buttonPrimary,
  buttonQuiet,
  buttonSecondary,
  card,
  errorNotice,
  hint,
  notice,
} from "@/lib/ui";

/**
 * The owner's page for the people on a team (24 Oct 2026): who is waiting for a yes, who is on
 * it, and the invitation codes still open. A code is shown once, when it is made — only its hash
 * is kept — and whoever holds it still waits for the owner to let them in.
 *
 * Every tap goes to the database, which checks again that the caller is the team's owner; what
 * is drawn here decides nothing (safety rule 5). A dispatcher takes requests from a computer; a field
 * member sees only the cases handed to them, on their own phone.
 */

type Fresh = { unitId: string; code: string; expiresAt: string };

const time = new Intl.DateTimeFormat("en-GB", BANGKOK_DATE_TIME);

export function TeamMembers({ teams, preview = false }: { teams: OwnedTeam[]; preview?: boolean }) {
  const t = useTranslations("unitTeam");
  const locale = useLocale();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [fresh, setFresh] = useState<Fresh | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function send(key: string, body: Record<string, unknown>) {
    if (preview) {
      // The admin's preview: a sample code is shown and nothing is made, sent or changed.
      if (body.action === "invite") {
        setFresh({
          unitId: String(body.unit),
          code: "7F3A9C21B4",
          expiresAt: teams[0]?.invites[0]?.expiresAt ?? "2026-10-26T00:00:00.000Z",
        });
        setCopied(false);
      }
      return;
    }
    setBusy(key);
    setError(null);
    try {
      const res = await fetch("/api/authority/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const answer = (await res.json().catch(() => ({}))) as {
        code?: string | null;
        expiresAt?: string | null;
        error?: string;
      };
      if (!res.ok) {
        setError(answer.error === "limit" ? t("errors.limit") : t("errors.failed"));
        return;
      }
      if (body.action === "invite" && answer.code && answer.expiresAt) {
        setFresh({ unitId: String(body.unit), code: answer.code, expiresAt: answer.expiresAt });
        setCopied(false);
      }
      router.refresh();
    } catch {
      setError(t("errors.failed"));
    } finally {
      setBusy(null);
    }
  }

  async function copy(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  if (teams.length === 0) {
    return (
      <section className={card}>
        <p>{t("none")}</p>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {error && (
        <p className={errorNotice} role="alert">
          {error}
        </p>
      )}
      {teams.map((team) => {
        const waiting = team.members.filter((m) => m.status === "pending");
        const people = team.members.filter((m) => m.status === "active");
        const link =
          fresh?.unitId === team.unitId && typeof window !== "undefined"
            ? `${window.location.origin}${locale === routing.defaultLocale ? "" : `/${locale}`}/authority/join?code=${fresh.code}`
            : "";
        return (
          <section key={team.unitId} className={card} data-team={team.unitId}>
            <div className="flex flex-col">
              <h2 className="text-h3 font-bold text-jaga-ink">{team.unitName}</h2>
              {team.orgName && <p className={hint}>{team.orgName}</p>}
            </div>

            <div className="grid gap-5 lg:grid-cols-2 lg:gap-8">
              <div className="flex flex-col gap-4">
                {waiting.length > 0 && (
                  <div className="flex flex-col gap-2" data-team-waiting="true">
                    <h3 className="font-bold text-jaga-ink">{t("waiting.title")}</h3>
                    <p className={hint}>{t("waiting.hint")}</p>
                    {waiting.map((m) => (
                      <div key={m.id} className={`${notice} flex flex-col gap-2`}>
                        <p className="font-medium">
                          {m.name || t("noName")}{" "}
                          <span className={hint}>· {t(`role.${m.role}`)}</span>
                        </p>
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <button
                            type="button"
                            className={buttonPrimary}
                            disabled={busy !== null}
                            onClick={() =>
                              send(`yes${m.id}`, { action: "decide", id: m.id, approve: true })
                            }
                            data-member-yes="true"
                          >
                            <CheckIcon aria-hidden="true" className="size-5" />
                            {t("waiting.yes")}
                          </button>
                          <button
                            type="button"
                            className={buttonSecondary}
                            disabled={busy !== null}
                            onClick={() =>
                              send(`no${m.id}`, { action: "decide", id: m.id, approve: false })
                            }
                            data-member-no="true"
                          >
                            <CrossIcon aria-hidden="true" className="size-5" />
                            {t("waiting.no")}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex flex-col gap-2">
                  <h3 className="font-bold text-jaga-ink">{t("people.title")}</h3>
                  <ul className="flex flex-col gap-2">
                    {people.map((m) => (
                      <li
                        key={m.id}
                        className="flex items-center justify-between gap-3"
                        data-member={m.id}
                      >
                        <span className="flex flex-col">
                          <span className="font-medium">
                            {m.name || t("noName")}
                            {m.isMe && <span className={hint}> · {t("you")}</span>}
                          </span>
                          <span className={hint}>{t(`role.${m.role}`)}</span>
                        </span>
                        {m.role !== "owner" && (
                          <button
                            type="button"
                            className={buttonQuiet}
                            disabled={busy !== null}
                            onClick={() => send(`rm${m.id}`, { action: "remove", id: m.id })}
                            aria-label={t("people.remove", { name: m.name || t("noName") })}
                            data-member-remove="true"
                          >
                            <TrashIcon aria-hidden="true" className="size-5" />
                            {t("people.removeShort")}
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <h3 className="font-bold text-jaga-ink">{t("invite.title")}</h3>
                <p className={hint}>{t("invite.hint")}</p>
                <p className={hint}>{t("invite.hintField")}</p>
                <button
                  type="button"
                  className={buttonSecondary}
                  disabled={busy !== null}
                  onClick={() =>
                    send(`inv${team.unitId}`, {
                      action: "invite",
                      unit: team.unitId,
                      role: "dispatcher",
                    })
                  }
                  data-invite="true"
                >
                  <PersonIcon aria-hidden="true" className="size-5" />
                  {t("invite.make")}
                </button>
                <button
                  type="button"
                  className={buttonSecondary}
                  disabled={busy !== null}
                  onClick={() =>
                    send(`invf${team.unitId}`, {
                      action: "invite",
                      unit: team.unitId,
                      role: "field",
                    })
                  }
                  data-invite="field"
                >
                  <PersonIcon aria-hidden="true" className="size-5" />
                  {t("invite.makeField")}
                </button>
                {fresh?.unitId === team.unitId && (
                  <div className={`${notice} flex flex-col gap-2`} data-invite-fresh="true">
                    <p className={hint}>{t("invite.code")}</p>
                    <p
                      className="text-h3 font-bold tracking-widest text-jaga-ink"
                      dir="ltr"
                      data-invite-code="true"
                    >
                      {fresh.code.slice(0, 5)}-{fresh.code.slice(5)}
                    </p>
                    <p className={hint}>
                      {t("invite.until", { time: time.format(new Date(fresh.expiresAt)) })}
                    </p>
                    {link && (
                      <button type="button" className={buttonSecondary} onClick={() => copy(link)}>
                        <ShareIcon aria-hidden="true" className="size-5" />
                        {copied ? t("invite.copied") : t("invite.copy")}
                      </button>
                    )}
                    <p className={hint}>{t("invite.once")}</p>
                  </div>
                )}
                {team.invites.length > 0 && (
                  <ul className="flex flex-col gap-2" data-invites-open="true">
                    {team.invites.map((i) => (
                      <li key={i.id} className="flex items-center justify-between gap-3">
                        <span className={hint}>
                          {t("invite.open", {
                            role: t(`role.${i.role}`),
                            time: time.format(new Date(i.expiresAt)),
                          })}
                        </span>
                        <button
                          type="button"
                          className={buttonQuiet}
                          disabled={busy !== null}
                          onClick={() => send(`rv${i.id}`, { action: "revoke", id: i.id })}
                          data-invite-cancel="true"
                        >
                          {t("invite.cancel")}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}
