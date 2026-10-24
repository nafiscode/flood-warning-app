#!/usr/bin/env node
/**
 * Take a dump of the Supabase database in SUPABASE_DB_URL (jaga-dev, which is the live database
 * while Jaga runs on the free plan: Supabase keeps no daily backups there).
 *
 *   npm run db:dump
 *
 * The file goes to ../jaga-backups/ (next to the repo, never inside it) unless JAGA_DUMP_DIR is
 * set. It holds phone numbers and the locations of people asking for rescue: keep it off GitHub,
 * shared drives and chat. Schemas public, auth and storage; the address is never printed.
 * Needs pg_dump from PostgreSQL 17 or newer on PATH, or PG_DUMP set to its full path.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
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

const url = envValue("SUPABASE_DB_URL");
if (!url || url.includes("[YOUR-PASSWORD]")) {
  console.error("SUPABASE_DB_URL is missing or still has the placeholder in .env.local.");
  process.exit(2);
}

const dir = resolve(repo, envValue("JAGA_DUMP_DIR") ?? join("..", "jaga-backups"));
if (dir === repo || dir.startsWith(repo + "\\") || dir.startsWith(repo + "/")) {
  console.error(`Refusing to write a dump inside the repo (${dir}): it holds personal data.`);
  process.exit(2);
}
mkdirSync(dir, { recursive: true });

let ref = "database";
try {
  const at = new URL(url);
  ref = /^postgres\.([a-z0-9]{16,})$/.exec(decodeURIComponent(at.username))?.[1] ?? at.hostname;
} catch {
  // The URL parser may not take every connection string; pg_dump will say so itself.
}
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-");
const file = join(dir, `jaga-${ref.slice(0, 8)}-${stamp}Z.dump`);

const pgDump = envValue("PG_DUMP") ?? "pg_dump";
console.error(`Dumping ${ref} to ${file}`);
const result = spawnSync(
  pgDump,
  [
    "--format=custom",
    "--no-owner",
    "--no-privileges",
    "--schema=public",
    "--schema=auth",
    "--schema=storage",
    `--file=${file}`,
    url,
  ],
  { stdio: ["ignore", "inherit", "inherit"], cwd: repo },
);
if (result.error) {
  console.error(`Could not run ${pgDump}: ${result.error.message}`);
  process.exit(2);
}
if (result.status !== 0) {
  console.error("pg_dump failed. A 'server version mismatch' means pg_dump is older than Supabase's Postgres: install PostgreSQL 17 client tools or set PG_DUMP.");
  process.exit(result.status ?? 1);
}
const mb = (statSync(file).size / 1048576).toFixed(1);
console.error(`Done: ${mb} MB. Keep it off the repo, GitHub and chat.`);
