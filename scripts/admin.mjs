#!/usr/bin/env node
/**
 * Make the first super admin (the owner). Every later admin is invited from the admin console.
 *
 *   node scripts/admin.mjs super-admin <email>
 *
 * Creates an account for the email if there is none (no email is sent), then sets its role in
 * the database. The person signs in from /sign-in → "For admins" with that address.
 * Uses SUPABASE_SECRET_KEY and SUPABASE_DB_URL from the environment or .env.local; neither is
 * printed. Run it against the dev project now and against the live project at launch.
 */
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

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

const [command, emailArg] = process.argv.slice(2);
const email = (emailArg ?? "").trim().toLowerCase();
if (command !== "super-admin" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error("Usage: node scripts/admin.mjs super-admin <email>");
  process.exit(2);
}
const url = envValue("NEXT_PUBLIC_SUPABASE_URL");
const secret = envValue("SUPABASE_SECRET_KEY");
const dbUrl = envValue("SUPABASE_DB_URL");
if (!url || !secret || !dbUrl) {
  console.error(
    "NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY and SUPABASE_DB_URL must be set in .env.local.",
  );
  process.exit(2);
}

const supabase = createClient(url, secret, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { error } = await supabase.auth.admin.createUser({ email, email_confirm: true });
if (error && error.status !== 422 && error.code !== "email_exists") {
  console.error(`Could not create the account: ${error.message}`);
  process.exit(1);
}

const db = new pg.Client({ connectionString: dbUrl });
await db.connect();
try {
  const { rowCount } = await db.query(
    `update public.profiles p set role = 'super_admin'
     from auth.users u
     where u.id = p.user_id and lower(u.email) = $1 and u.email_confirmed_at is not null`,
    [email],
  );
  if (rowCount !== 1) {
    console.error("No confirmed account with that email was found; nothing changed.");
    process.exitCode = 1;
  } else {
    await db.query(
      `insert into public.audit_log (action, entity, entity_id, details)
       select 'bootstrap_super_admin', 'profiles', u.id::text, '{"by": "scripts/admin.mjs"}'::jsonb
       from auth.users u where lower(u.email) = $1`,
      [email],
    );
    console.log(`${email} is now a super admin. Sign in at /sign-in, under "For admins".`);
  }
} finally {
  await db.end();
}
