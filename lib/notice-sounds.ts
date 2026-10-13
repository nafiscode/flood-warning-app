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
  const fresh = items.filter((i) => !seen.has(i.id));
  if (fresh.length === 0) return { sound: null, ids: [] };
  const ids = fresh.map((i) => i.id);
  const alert = ringFor(items, read, rung).sound;
  if (alert) return { sound: alert, ids };
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
