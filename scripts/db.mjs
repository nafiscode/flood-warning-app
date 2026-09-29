#!/usr/bin/env node
/**
 * Run a Supabase CLI database command against the dev project (jaga-dev) using SUPABASE_DB_URL
 * from the environment or .env.local. No `supabase login` or `supabase link` needed.
 * The connection string is passed straight to the CLI and never printed.
 *
 *   node scripts/db.mjs db push [--dry-run]
 *   node scripts/db.mjs db reset          (dev project only: wipes and rebuilds from migrations + seed)
 *   node scripts/db.mjs migration list
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
if (args.length === 0) {
  console.error("Usage: node scripts/db.mjs <supabase command...>  e.g. db push --dry-run");
  process.exit(2);
}
const url = envValue("SUPABASE_DB_URL");
if (!url || url.includes("[YOUR-PASSWORD]")) {
  console.error(
    "SUPABASE_DB_URL is missing or still has the [YOUR-PASSWORD] placeholder in .env.local. " +
      'See SETUP.md, "One-time: the Supabase dev project".',
  );
  process.exit(2);
}

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
