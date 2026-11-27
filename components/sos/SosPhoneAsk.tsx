"use client";

import { SendIcon } from "@/components/icons";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { normalizePhone } from "@/lib/phone";
import { enqueue } from "@/lib/queue";
import { buttonPrimary, card, hint, input, label, notice } from "@/lib/ui";

type Props = {
  id: string;
  token: string | null;
  /** Called once the number is saved, so the page reads the case again and the card goes away. */
  onSaved: () => void;
};

/**
 * "Give a phone number" on the sender's own case page, shown while the case is open and has no
 * number on file (owner, 28 Nov 2026). It is where the push "a number would help" lands, and it
 * is there for anyone whose request went out without one.
 *
 * Optional by design: nothing here blocks or delays the request, which is already on the teams'
 * boards (safety rule 1). The number goes into the case the way the details form's does, and if
 * the connection is down it is queued and sent when it returns.
 */
export function SosPhoneAsk({ id, token, onSaved }: Props) {
  const t = useTranslations("sos");
  const [phone, setPhone] = useState("");
  const [tried, setTried] = useState(false);
  const [state, setState] = useState<"ready" | "saving" | "saved">("ready");
  const number = normalizePhone(phone);

  async function save() {
    setTried(true);
    if (!number) return;
    setState("saving");
    const body = { action: "details", token, phone: number };
    try {
      const response = await fetch(`/api/sos/${id}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { "x-jaga-sos-token": token } : {}),
        },
        body: JSON.stringify(body),
        cache: "no-store",
      });
      if (!response.ok) throw new Error(String(response.status));
    } catch {
      // Worth sending late: the queue keeps it and retries.
      await enqueue("sos-details", `/api/sos/${id}`, body as unknown as Record<string, unknown>);
    }
    setState("saved");
    onSaved();
  }

  if (state === "saved") {
    return (
      <p className={notice} role="status" data-sos-phone-saved="true">
        {t("phoneAsk.saved")}
      </p>
    );
  }

  return (
    <div className={`${card} border-2 border-sos`} data-sos-phone-ask="true">
      <h2 className="text-h3 font-bold text-jaga-ink">{t("phoneAsk.title")}</h2>
      <label className="flex flex-col gap-2">
        <span className={label}>{t("phoneLabel")}</span>
        <input
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          name="phone"
          value={phone}
          aria-invalid={tried && !number}
          onChange={(event) => setPhone(event.target.value)}
          className={input}
        />
        <span className="font-medium text-jaga-ink">{t("phoneHint")}</span>
      </label>
      {tried && !number && (
        <p role="alert" className={notice}>
          {t("phoneAsk.invalid")}
        </p>
      )}
      <button
        type="button"
        onClick={() => void save()}
        disabled={state === "saving"}
        className={buttonPrimary}
      >
        <SendIcon size={22} />
        {state === "saving" ? t("details.saving") : t("phoneAsk.save")}
      </button>
      <p className={hint}>{t("phoneAsk.private")}</p>
    </div>
  );
}
