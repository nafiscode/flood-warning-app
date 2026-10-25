"use client";

import { buttonSecondary } from "@/lib/ui";

/**
 * "Use the suggested wording" (the owner, 25 Oct 2026). Fills the three message boxes with a draft
 * for the "no rescue team here" announcement, picks the matching recipient, and ticks the Share
 * button, so an admin starts from the whole thing and only edits what they want. Progressive
 * enhancement: with no JavaScript the admin picks the recipient and writes the text themselves, as
 * before. The draft text is passed in from the server, so it lives in messages/*.json like all copy.
 */
export function AnnouncementDraft({
  label,
  text,
}: {
  label: string;
  text: { th: string; ms: string; en: string };
}) {
  function fill() {
    const form = document.querySelector<HTMLFormElement>("form[data-announce-form]");
    if (!form) return;
    for (const [name, value] of Object.entries(text)) {
      const field = form.elements.namedItem(name);
      if (field instanceof HTMLTextAreaElement) field.value = value;
    }
    const noTeam = form.querySelector<HTMLInputElement>('input[name="scope"][value="noTeam"]');
    if (noTeam) noTeam.checked = true;
    const cta = form.querySelector<HTMLInputElement>('input[name="cta"][value="share_app"]');
    if (cta) cta.checked = true;
  }

  return (
    <button type="button" onClick={fill} className={`${buttonSecondary} self-start`} data-draft="noTeam">
      {label}
    </button>
  );
}
