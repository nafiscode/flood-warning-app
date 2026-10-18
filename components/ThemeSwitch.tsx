"use client";

import { useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { MoonIcon, SunIcon } from "@/components/icons";
import { writeStored } from "@/lib/phone-store";
import { holdForVisit, OTHER, pickChoice, THEME_KEY, type ThemeMode } from "@/lib/theme";

/**
 * The theme switch, beside the bell (the owner's request, 18 Oct). Every visit still arrives in
 * the colour the time of day asks for (DaylightTheme); this is for the person it does not suit -
 * a bright room at night, a dark one at noon, eyes that prefer the other.
 *
 * It shows where it would take them, not where they are: a moon to go dark, a sun to come back.
 * The theme it is switching away from is written out in the label as well, because an icon on
 * its own does not say which of the two is on.
 */
/*
 * What the page is actually wearing, read from the page itself and kept in step with it: before
 * the first paint a script sets it from the sun or from today's choice, and DaylightTheme may
 * change it while the app is open. That attribute is the one truth, so this watches it instead
 * of keeping a second copy that could disagree with what people can see.
 */
function watchTheme(onChange: () => void): () => void {
  const watcher = new MutationObserver(onChange);
  watcher.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => watcher.disconnect();
}

const showing = (): ThemeMode =>
  document.documentElement.dataset.theme === "dark" ? "dark" : "light";

export function ThemeSwitch({ className = "" }: { className?: string }) {
  const t = useTranslations("nav");
  // Null while the page is still the server's HTML: nothing is drawn until it can be read, so
  // the icon never shows the wrong way round and then swaps. The space it takes is held open.
  const mode = useSyncExternalStore(watchTheme, showing, () => null);
  const next = mode ? OTHER[mode] : null;

  const switchTo = () => {
    if (!next) return;
    holdForVisit(next);
    writeStored(THEME_KEY, pickChoice(next, Date.now()));
    // Painted here and not left to DaylightTheme's effect, so the colours change under the
    // finger that pressed it; the attribute is what this button then reads back.
    document.documentElement.dataset.theme = next;
  };

  return (
    <button
      type="button"
      onClick={switchTo}
      disabled={!next}
      aria-label={next ? t(next === "dark" ? "themeToDark" : "themeToLight") : t("theme")}
      title={next ? t(next === "dark" ? "themeToDark" : "themeToLight") : t("theme")}
      data-theme-switch={mode ?? ""}
      // Drawn like the bell and the "?": 36 px wide, the hit area stretched back out to 48 px,
      // because at 360 px a wider button pushes the header onto another row.
      className={`relative inline-flex min-h-tap w-9 items-center justify-center rounded text-white after:absolute after:-inset-x-1 after:inset-y-0 after:content-[''] lg:w-12 ${className}`}
    >
      {next === "light" ? <SunIcon size={24} /> : <MoonIcon size={24} />}
    </button>
  );
}
