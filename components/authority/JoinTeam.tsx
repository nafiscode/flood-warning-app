"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { PersonIcon } from "@/components/icons";
import { buttonPrimary, errorNotice, hint, input, label, notice } from "@/lib/ui";

/**
 * Joining a team with a code from its owner (24 Oct 2026). The person waits until the owner says
 * yes, and the page says so plainly: a code opens nothing by itself. A code that does not work
 * gets one answer, whatever the reason, so the page tells nobody which codes exist.
 */
export function JoinTeam({ initialCode }: { initialCode: string }) {
  const t = useTranslations("unitTeam");
  const [code, setCode] = useState(initialCode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joined, setJoined] = useState<{ unitName: string; status: string } | null>(null);

  async function join() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/authority/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "join", code }),
      });
      const answer = (await res.json().catch(() => ({}))) as {
        unitName?: string;
        status?: string;
        error?: string;
      };
      if (res.ok) {
        setJoined({ unitName: answer.unitName ?? "", status: answer.status ?? "pending" });
      } else if (answer.error === "limit") {
        setError(t("join.limit"));
      } else {
        setError(t("join.wrong"));
      }
    } catch {
      setError(t("errors.failed"));
    } finally {
      setBusy(false);
    }
  }

  if (joined) {
    return (
      <div className={notice} role="status" data-join-done={joined.status}>
        <p className="font-bold text-jaga-ink">{joined.unitName}</p>
        <p>{joined.status === "active" ? t("join.already") : t("join.waiting")}</p>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (code.trim() !== "") void join();
      }}
    >
      <label className="flex flex-col gap-1">
        <span className={label}>{t("join.codeLabel")}</span>
        <input
          className={`${input} text-center tracking-widest`}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          dir="ltr"
          maxLength={40}
          data-join-code="true"
        />
        <span className={hint}>{t("join.codeHint")}</span>
      </label>
      {error && (
        <p className={errorNotice} role="alert">
          {error}
        </p>
      )}
      <button type="submit" className={buttonPrimary} disabled={busy || code.trim() === ""}>
        <PersonIcon aria-hidden="true" className="size-5" />
        {t("join.submit")}
      </button>
    </form>
  );
}
