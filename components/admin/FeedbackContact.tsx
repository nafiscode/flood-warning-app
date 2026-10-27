"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { PhoneIcon } from "@/components/icons";
import { buttonSecondary, hint } from "@/lib/ui";

/**
 * The contact a person left, revealed on a tap and never drawn with the row (A15, spec 17; safety
 * rule 5: every reveal of a phone number is written to `audit_log`).
 *
 * The button is what makes the reveal an act. A contact printed in a list is read by everyone who
 * walks past the screen and logged against nobody; a contact behind a tap is read by the admin
 * who needed it, under their own account.
 */
export function FeedbackContact({ id }: { id: string }) {
  const t = useTranslations("adminFeedback");
  const [contact, setContact] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "asking" | "none" | "failed">("idle");

  async function show() {
    setState("asking");
    try {
      const response = await fetch("/api/admin/feedback-contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
        cache: "no-store",
      });
      if (!response.ok) throw new Error(String(response.status));
      const answer = (await response.json()) as { contact: string | null };
      if (answer.contact) {
        setContact(answer.contact);
        setState("idle");
      } else {
        setState("none");
      }
    } catch {
      setState("failed");
    }
  }

  if (contact) {
    return (
      <p className="font-medium text-jaga-ink" data-feedback-contact={id}>
        {contact}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => void show()}
        disabled={state === "asking"}
        className={buttonSecondary}
        data-reveal-contact={id}
      >
        <PhoneIcon size={22} />
        {t("contact.show")}
      </button>
      <p className={hint}>
        {state === "none" ? t("contact.cleared") : state === "failed" ? t("error.save") : t("contact.logged")}
      </p>
    </div>
  );
}
