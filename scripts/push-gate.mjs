// Set up the push gate of a Supabase project (A7): the token Jaga's server proves itself with
// when it asks the database which notifications about requests for help are owed, and the site
// address the database knocks on once a minute.
//
//   npm run push:gate -- https://<the site's address>
//
// Run once per project, and again if the site's address or the VAPID keys ever change. It reads
// VAPID_PRIVATE_KEY and SUPABASE_DB_URL from .env.local and prints neither. The token is derived
// from the private key exactly as lib/push-server.ts derives it, so the two always agree.
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";

const site = (process.argv[2] ?? "").replace(/\/+$/, "");
if (!/^https:\/\/[a-z0-9.-]+$/.test(site)) {
  console.error("Usage: npm run push:gate -- https://<site address>   (https, no path)");
  process.exit(1);
}
const env = {};
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const i = line.indexOf("=");
  if (i > 0)
    env[line.slice(0, i).trim()] = line
      .slice(i + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
}
if (!env.VAPID_PRIVATE_KEY || !env.SUPABASE_DB_URL) {
  console.error("VAPID_PRIVATE_KEY and SUPABASE_DB_URL must be in .env.local");
  process.exit(1);
}
const token = createHmac("sha256", env.VAPID_PRIVATE_KEY).update("jaga-push-gate-v1").digest("hex");
const db = new pg.Client({
  connectionString: env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});
await db.connect();
try {
  await db.query(
    `insert into public.push_gate (id, token, site_url) values (true, $1, $2)
     on conflict (id) do update set token = excluded.token, site_url = excluded.site_url,
                                    updated_at = now()`,
    [token, site],
  );
  console.log(`Push gate set. The database will knock on ${site}/api/push/tick once a minute.`);
} finally {
  await db.end();
}
