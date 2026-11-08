import { ringFor, type NoticeItem } from "@/lib/notices";
import type { SoundName } from "@/lib/sounds";

/**
 * Every new item in the bell is heard once (the owner, 13 Oct: "all notification bell have voice
 * for each notification"), and what it sounds like says what kind of thing it is:
 *
 *  - an alert in force rings with its level's own sound, and a dam release with its own;
 *  - an announcement from the admins sounds positive - a rising chime, nothing like an alarm;
 *  - a step of one's own request uses the sounds the request's own page makes (a team accepted,
 *    it is over);
 *  - anything else (an alert that has ended, news about one's team) gets two quiet notes.
 *
 * When several things are new at once, one sound plays: the most serious. An alert always wins,
 * so good news can never cover a warning. `ids` is everything that sound answers for, so each
 * item rings once on a phone and no more.
 */
export function ringForAll(
  items: readonly NoticeItem[],
  read: readonly string[],
  rung: readonly string[],
): { sound: SoundName | null; ids: string[] } {
  const seen = new Set([...read, ...rung]);
  // An admin's queue never makes a sound (the owner, 22 Oct). It is left out here rather than
  // given a quiet tone, because the fallback at the end of this function would otherwise ring
  // "notice" for it - and a backlog has no moment at which it happens.
  const fresh = items.filter((i) => !seen.has(i.id) && i.kind !== "adminQueue");
  if (fresh.length === 0) return { sound: null, ids: [] };
  const ids = fresh.map((i) => i.id);
  const alert = ringFor(items, read, rung).sound;
  if (alert) return { sound: alert, ids };
  // An automatic alarm is urgent in both of its shapes: a draft held back for an admin, which
  // Jaga publishes by itself unless someone acts within the grace time, and - since 9 Nov 2026 -
  // one that has already published, where the admin needs to know an alert is in force even
  // though their own tambons may not be in it. Both sound like the alert, whatever the tick.
  const draft = fresh.find(
    (i): i is Extract<NoticeItem, { kind: "autoAlarm" }> =>
      i.kind === "autoAlarm" &&
      (i.status === "pending" || (i.status === "auto_published" && i.atOnce)),
  );
  if (draft)
    return {
      sound:
        draft.level === "evacuate"
          ? "alertEvacuate"
          : draft.level === "return"
            ? "alertReturn"
            : "alertWarning",
      ids,
    };
  // An alert that is new to this phone but has already ended is news, not a warning.
  const kinds = new Set(fresh.map((i) => i.kind as string));
  const caseEvents = fresh.flatMap((i) =>
    i.kind === "sos" ? [(i as { event: string }).event] : [],
  );
  const sound: SoundName = kinds.has("announcement")
    ? "announcement"
    : caseEvents.some((e) => e === "rescued" || e === "confirmed" || e === "rescued_by_team")
      ? "rescued"
      : caseEvents.length > 0
        ? "accepted"
        : "notice";
  return { sound, ids };
}
