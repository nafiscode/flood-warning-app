import { readFile } from "node:fs/promises";
import path from "node:path";
import { routing, type Locale } from "@/i18n/routing";

/**
 * The operational status note (A10, docs/runbook.md "Static status page"). It lives in the repo
 * at public/status/notice.json, NOT in the database, so /status still answers while Supabase or a
 * console is down. The owner edits it on github.com and commits to `main`; Vercel redeploys in
 * about two minutes and the note shows without any database.
 *
 * This is about the app itself, never about flood conditions: it carries no alert level and never
 * uses the alert palette (safety rules 3 and 10). An empty file (`{}`) means "nothing to say".
 */

/** How the service is doing. "ok" is the empty-file default; the other two mean a posted note. */
export type ServiceLevel = "ok" | "degraded" | "down";

export interface ServiceStatus {
  level: ServiceLevel;
  /** When the note was posted (ISO string), if the file gives one; null otherwise. */
  since: string | null;
  /** The note in this reader's language, already resolved; null when the file is empty. */
  message: string | null;
}

/** The shape the owner writes in notice.json when there is something to say. */
interface RawNotice {
  level?: unknown;
  since?: unknown;
  message?: unknown;
}

const FILE = path.join(process.cwd(), "public", "status", "notice.json");
const NOTHING_TO_SAY: ServiceStatus = { level: "ok", since: null, message: null };

/** The note for `locale`, falling back to Thai then English then nothing. */
function pickMessage(message: Record<string, unknown>, locale: Locale): string | null {
  const order: Locale[] = [locale, routing.defaultLocale, "en"];
  for (const l of order) {
    const v = message[l];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

/**
 * Turn the parsed file into a status. Unknown or missing `level` is "ok"; anything the owner did
 * not spell out is simply left off. A posted level with no readable message is still shown: the
 * level alone already tells the reader Jaga knows about a problem.
 */
export function parseNotice(raw: unknown, locale: Locale): ServiceStatus {
  if (!raw || typeof raw !== "object") return NOTHING_TO_SAY;
  const n = raw as RawNotice;
  const level: ServiceLevel =
    n.level === "down" ? "down" : n.level === "degraded" ? "degraded" : "ok";
  if (level === "ok") return NOTHING_TO_SAY;
  const message =
    n.message && typeof n.message === "object"
      ? pickMessage(n.message as Record<string, unknown>, locale)
      : null;
  const since = typeof n.since === "string" ? n.since : null;
  return { level, since, message };
}

/**
 * Read and parse the note. A missing, empty or unreadable file is treated as "nothing to say"
 * rather than an error: the page must always render, and the quiet state is the safe one to fall
 * back to. (Invalid JSON while a real note is up is a risk the runbook guards by editing on
 * github.com, which flags JSON errors before the commit.)
 */
export async function readServiceStatus(locale: Locale): Promise<ServiceStatus> {
  let text: string;
  try {
    text = await readFile(FILE, "utf8");
  } catch {
    return NOTHING_TO_SAY;
  }
  try {
    return parseNotice(JSON.parse(text), locale);
  } catch {
    return NOTHING_TO_SAY;
  }
}
