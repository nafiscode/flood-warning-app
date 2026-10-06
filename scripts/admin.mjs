#!/usr/bin/env node
/**
 * Admin accounts from this laptop.
 *
 *   node scripts/admin.mjs super-admin <email>   make the one super admin (the project account)
 *   node scripts/admin.mjs invite <email>        invite an admin, in the super admin's name
 *
 * Both create an account for the email if there is none (no email is sent). The person then
 * signs in from /sign-in → "For admins" with that address. An invited person becomes an admin
 * only when they sign in through a link sent to that address; invitations lapse after 14 days.
 * `invite` does what the Invitations page does; it exists because that page needs the secret
 * key, which is deliberately not on the live site (decision 2026-09-29).
 *
 * Uses SUPABASE_SECRET_KEY and SUPABASE_DB_URL from the environment or .env.local; neither is
 * printed. Run `super-admin` once per Supabase project (dev now, live at launch).
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
if (!["super-admin", "invite"].includes(command) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error(
    "Usage: node scripts/admin.mjs super-admin <email>\n       node scripts/admin.mjs invite <email>",
  );
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

async function makeSuperAdmin(db) {
  // One super admin only (decision 2026-10-06): stop if someone else already has the role.
  const others = await db.query(
    `select 1 from public.profiles p join auth.users u on u.id = p.user_id
     where p.role = 'super_admin' and lower(u.email) is distinct from $1`,
    [email],
  );
  if (others.rowCount > 0) {
    console.error("Another account is already the super admin; nothing changed.");
    return 1;
  }
  const { rowCount } = await db.query(
    `update public.profiles p set role = 'super_admin'
     from auth.users u
     where u.id = p.user_id and lower(u.email) = $1 and u.email_confirmed_at is not null`,
    [email],
  );
  if (rowCount !== 1) {
    console.error("No confirmed account with that email was found; nothing changed.");
    return 1;
  }
  await db.query(
    `insert into public.audit_log (action, entity, entity_id, details)
     select 'bootstrap_super_admin', 'profiles', u.id::text, '{"by": "scripts/admin.mjs"}'::jsonb
     from auth.users u where lower(u.email) = $1`,
    [email],
  );
  console.log(`${email} is now the super admin. Sign in at /sign-in, under "For admins".`);
  return 0;
}

async function invite(db) {
  const inviter = await db.query(
    "select user_id from public.profiles where role = 'super_admin' order by created_at limit 1",
  );
  if (inviter.rowCount !== 1) {
    console.error("There is no super admin yet; run `super-admin` first.");
    return 1;
  }
  const already = await db.query(
    `select p.role from public.profiles p join auth.users u on u.id = p.user_id
     where lower(u.email) = $1 and p.role in ('admin', 'super_admin')`,
    [email],
  );
  if (already.rowCount > 0) {
    console.error("That address already belongs to an admin; nothing changed.");
    return 1;
  }
  // Withdraw an older pending invitation for the same address, so the 14 days start again.
  await db.query(
    "update public.admin_invitations set status = 'revoked' where email_or_phone = $1 and status = 'pending'",
    [email],
  );
  const { rows } = await db.query(
    `insert into public.admin_invitations (email_or_phone, role, invited_by)
     values ($1, 'admin', $2) returning id`,
    [email, inviter.rows[0].user_id],
  );
  await db.query(
    `insert into public.audit_log (actor, action, entity, entity_id, details)
     values ($1, 'invite_admin', 'admin_invitations', $2, '{"by": "scripts/admin.mjs"}'::jsonb)`,
    [inviter.rows[0].user_id, rows[0].id],
  );
  console.log(
    `${email} is invited as an admin for 14 days. They sign in at /sign-in, under "For admins".`,
  );
  return 0;
}

const db = new pg.Client({ connectionString: dbUrl });
await db.connect();
try {
  process.exitCode = command === "invite" ? await invite(db) : await makeSuperAdmin(db);
} finally {
  await db.end();
}
