#!/usr/bin/env node
/**
 * Run a Supabase CLI database command against the dev project (jaga-dev) using SUPABASE_DB_URL
 * from the environment or .env.local. No `supabase login` or `supabase link` needed.
 * The connection string is passed straight to the CLI and never printed.
 *
 *   node scripts/db.mjs db push [--dry-run]
 *   node scripts/db.mjs db reset          (dev project only, and refused unless JAGA_ALLOW_RESET=1)
 *   node scripts/db.mjs migration list
 *
 * With `--live` as the first argument it acts on the live project instead (LIVE_DB_URL), which
 * is what walkthrough 7 builds. Three things guard it, because this is the database a flood
 * depends on: `db reset` and every other wipe are refused outright, the two addresses must
 * differ (a copied .env.local that points both at the same project would otherwise rebuild the
 * live one), and the project being acted on is named on screen before the CLI is handed the
 * command. Neither address is ever printed.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");

function envValue(key) {
  if (process.env[key]) return process.env[key];
  const file = join(repo, ".env.local");
  if (!existsSync(file)) return undefined;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const i = line.indexOf("=");
    if (i > 0 && line.slice(0, i).trim() === key) {
      const v = line
        .slice(i + 1)
        .trim()
        .replace(/^["']|["']$/g, "");
      if (v) return v;
    }
  }
  return undefined;
}

const args = process.argv.slice(2);
const live = args[0] === "--live";
if (live) args.shift();
if (args.length === 0) {
  console.error(
    "Usage: node scripts/db.mjs [--live] <supabase command...>  e.g. db push --dry-run",
  );
  process.exit(2);
}

/** Anything that empties or rebuilds a database. Never on the live project, whoever asks. */
const WIPES = new Set(["reset"]);
if (live && args[0] === "db" && WIPES.has(args[1] ?? "")) {
  console.error(
    `Refusing to run "db ${args[1]}" on the live project. It would wipe the database Jaga ` +
      "answers an SOS from. Rebuild the dev project instead (npm run db:reset), or restore the " +
      "live one from a backup on purpose.",
  );
  process.exit(2);
}

// From the 25 Oct launch on the free plan, the dev project is the database the live site reads, so
// wiping it is refused too. A deliberate rebuild (a scratch dev project, or a restore) sets
// JAGA_ALLOW_RESET=1 for that one command.
if (!live && args[0] === "db" && WIPES.has(args[1] ?? "") && process.env.JAGA_ALLOW_RESET !== "1") {
  console.error(
    `Refusing to run "db ${args[1]}": SUPABASE_DB_URL is the database the live site reads while ` +
      "Jaga runs on the free plan. Take a dump first (npm run db:dump). If you really mean it, " +
      "set JAGA_ALLOW_RESET=1 for this one command.",
  );
  process.exit(2);
}

const key = live ? "LIVE_DB_URL" : "SUPABASE_DB_URL";
const url = envValue(key);
if (!url || url.includes("[YOUR-PASSWORD]")) {
  console.error(
    `${key} is missing or still has the [YOUR-PASSWORD] placeholder in .env.local. ` +
      (live
        ? 'See the tracker, walkthrough 7 ("the live database").'
        : 'See SETUP.md, "One-time: the Supabase dev project".'),
  );
  process.exit(2);
}
if (live && url === envValue("SUPABASE_DB_URL")) {
  console.error(
    "LIVE_DB_URL and SUPABASE_DB_URL are the same address, so --live would act on the dev " +
      "project (or worse, the other way round). Fix .env.local before running this.",
  );
  process.exit(2);
}

// Which project this is about to touch, so a command is never run against the wrong one. The
// project's own name (its ref, which is public: it is part of NEXT_PUBLIC_SUPABASE_URL) and the
// host, never the address itself, which carries the password. Every project shares one pooler
// host, so the host alone would not say which project this is.
let where = "(unreadable address)";
try {
  const at = new URL(url);
  const ref = /^postgres\.([a-z0-9]{16,})$/.exec(decodeURIComponent(at.username))?.[1];
  where = ref ? `${ref} (${at.hostname})` : at.hostname;
} catch {
  // A connection string the URL parser doesn't take; the CLI will say so itself.
}
console.error(`${live ? "LIVE" : "dev"} database: ${where}`);

const cli = join(repo, "node_modules", "supabase", "dist", "supabase.js");
if (!existsSync(cli)) {
  console.error("Supabase CLI not found. Run `npm install` first.");
  process.exit(2);
}
// Arguments go straight to the process (no shell), so the URL is never echoed or logged.
const result = spawnSync(process.execPath, [cli, ...args, "--db-url", url], {
  stdio: "inherit",
  cwd: repo,
});
process.exit(result.status ?? 1);
