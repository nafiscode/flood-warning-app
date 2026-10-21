"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { BellIcon } from "@/components/icons";
import { useStandalone } from "@/lib/use-install";
import { useOnPhone } from "@/lib/phone-store";
import { SOUND_STEPS, soundGuide, type SoundGuide } from "@/lib/quiet";
import { hint } from "@/lib/ui";

/**
 * Where the phone keeps the sound it makes when a Jaga notification arrives (the owner, 21 Oct:
 * a drill reached their phone in silence, and they asked whether adding Jaga to the home screen
 * could make it ring).
 *
 * It cannot ring: Jaga's own alert sound is made by the open page, and with Jaga closed there is
 * no page. What the phone plays instead is its own notification sound, which is the person's
 * setting and not something any web app may touch. So this is written as steps rather than
 * built as a feature, and it says plainly at the top that Jaga cannot do it for them.
 *
 * Unlike the Do Not Disturb guide beside it, this one has no pictures: the screens differ too
 * much between Android brands to draw one honestly, and the words are short.
 */
export function SoundGuideView({ guide }: { guide: SoundGuide }) {
  const t = useTranslations("push.sound");
  const [open, setOpen] = useState(false);

  return (
    <div className="flex flex-col gap-3" data-sound={guide}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        data-sound-button="true"
        className="inline-flex min-h-tap items-center gap-2 self-start text-start underline"
      >
        <BellIcon size={22} className="shrink-0" />
        {t("button")}
      </button>
      {open && (
        <>
          <p>{t("intro")}</p>
          <ol className="flex flex-col gap-1" data-sound-steps={guide}>
            {Array.from({ length: SOUND_STEPS[guide] }, (_, i) => (
              <li key={i} className="flex items-start gap-3 p-1.5">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-jaga-line bg-jaga-ground font-bold text-jaga-ink">
                  {i + 1}
                </span>
                <span className="pt-1">{t(`${guide}.s${i + 1}`)}</span>
              </li>
            ))}
          </ol>
          <p className={hint}>{t("cannot")}</p>
          <p className={hint}>{t("repeat")}</p>
        </>
      )}
    </div>
  );
}

/** Which guide this phone gets. None on a computer, where there is no such setting for a site. */
export function useSoundGuide(): SoundGuide | null {
  const ready = useOnPhone();
  const installed = useStandalone();
  if (!ready) return null;
  return soundGuide(navigator.userAgent, installed, navigator.maxTouchPoints ?? 0);
}
