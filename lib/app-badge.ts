/**
 * The number on Jaga's own icon (home screen, taskbar or Dock) once it is installed: how many
 * things in the bell are still unread. The system draws it, in its own colour; the page only
 * hands over the number. Browsers without it, and Jaga in an ordinary tab, do nothing.
 *
 * It can only be set while Jaga is running. Changing it while the app is closed needs a push
 * message to wake the service worker, which is phase A7.
 */
type BadgeNavigator = Navigator & {
  setAppBadge?: (count?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

export function setIconBadge(count: number): void {
  if (typeof navigator === "undefined") return;
  const nav = navigator as BadgeNavigator;
  try {
    const done = count > 0 ? nav.setAppBadge?.(Math.floor(count)) : nav.clearAppBadge?.();
    // An iPhone refuses until notifications are allowed: nothing to tell the person about.
    done?.catch(() => {});
  } catch {
    // Not supported here.
  }
}
