/**
 * Test harness for RLS policies. Each test runs in one transaction on a single connection and is
 * rolled back, so nothing is left in the database. `as()` switches to the Postgres role and JWT
 * claims Supabase's API would use for that caller, so policies and auth.uid() behave as in the app.
 */
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { Client } from "pg";

function envValue(key: string): string | undefined {
  if (process.env[key]) return process.env[key];
  if (!existsSync(".env.local")) return undefined;
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
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

export async function connect(): Promise<Client> {
  const url = envValue("SUPABASE_DB_URL");
  if (!url || url.includes("[YOUR-PASSWORD]")) {
    throw new Error("SUPABASE_DB_URL is not set (environment or .env.local); see SETUP.md.");
  }
  const client = new Client({ connectionString: url });
  await client.connect();
  return client;
}

export type Caller = "anon" | { uid: string };

/** Act as a visitor ("anon") or a signed-in user, inside the current transaction. */
export async function as(db: Client, caller: Caller): Promise<void> {
  await db.query("reset role");
  if (caller === "anon") {
    await db.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ role: "anon" }),
    ]);
    await db.query("set local role anon");
  } else {
    await db.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: caller.uid, role: "authenticated" }),
    ]);
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [caller.uid]);
    await db.query("set local role authenticated");
  }
}

/** Back to the database owner (bypasses RLS) for setup and checks. */
export async function asOwner(db: Client): Promise<void> {
  await db.query("reset role");
  await db.query("select set_config('request.jwt.claims', '', true)");
  await db.query("select set_config('request.jwt.claim.sub', '', true)");
}

/** Run a statement expecting a permission or RLS error; returns the Postgres error code. */
export async function expectDenied(
  db: Client,
  sql: string,
  params: unknown[] = [],
): Promise<string> {
  await db.query("savepoint denied");
  try {
    await db.query(sql, params);
  } catch (e) {
    await db.query("rollback to savepoint denied");
    return (e as { code?: string }).code ?? "unknown";
  }
  await db.query("release savepoint denied");
  throw new Error(`Expected this to be denied, but it succeeded: ${sql}`);
}

export async function rows<T = Record<string, unknown>>(
  db: Client,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return (await db.query(sql, params)).rows as T[];
}

/** A fake auth user (the signup trigger creates the profile). */
export async function createUser(
  db: Client,
  opts: { name: string; phone?: string; role?: string } = { name: "test" },
): Promise<string> {
  const id = randomUUID();
  await db.query(
    `insert into auth.users (id, aud, role, email, phone, phone_confirmed_at, raw_user_meta_data)
     values ($1, 'authenticated', 'authenticated', $2, $3, case when $3::text is null then null else now() end, $4)`,
    [id, `${id}@test.invalid`, opts.phone ?? null, JSON.stringify({ display_name: opts.name })],
  );
  if (opts.role && opts.role !== "user") {
    await db.query("update public.profiles set role = $2 where user_id = $1", [id, opts.role]);
  }
  return id;
}
