/**
 * Puts the content of pages that are *about somebody* into the `site-content` bucket, from the
 * owner's own machine. The counterpart of scripts/fetch-content.mjs.
 *
 *   npm run content:push
 *
 * The source of truth is `pipeline/data/about/`, which is a clone of the **private** data repo
 * (see SETUP.md), so the words and the pictures are version-controlled somewhere the owner chose
 * rather than in this public repository. Nothing here reads or writes anything of a user's: the
 * bucket holds one person's own page, and that person is the one running this.
 *
 * It needs SUPABASE_SECRET_KEY, which is on the laptop and deliberately not on Vercel.
 */
import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { envValue } from "./env-local.mjs";

const BASE = (envValue("NEXT_PUBLIC_SUPABASE_URL") ?? "").replace(/\/+$/, "");
const KEY = envValue("SUPABASE_SECRET_KEY");
const BUCKET = "site-content";
const SOURCE = "pipeline/data/about";

if (!BASE || !KEY) {
  console.error("needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local");
  process.exit(1);
}

const TYPES = {
  ".json": "application/json",
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
};

/** Every file under the private source, as keys relative to it. */
async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (!entry.name.startsWith(".")) out.push(full);
  }
  return out;
}

const files = await walk(SOURCE);
if (!files.length) {
  console.error(`nothing in ${SOURCE}`);
  process.exit(1);
}

for (const file of files) {
  const key = `about/${relative(SOURCE, file).split("\\").join("/")}`;
  const type = TYPES[extname(file).toLowerCase()];
  if (!type) {
    console.log(`skipped ${key}: not a kind this bucket takes`);
    continue;
  }
  const body = await readFile(file);
  const res = await fetch(`${BASE}/storage/v1/object/${BUCKET}/${key}`, {
    method: "POST",
    headers: {
      // The project's keys are the newer `sb_secret_...` kind, which are not JWTs: they go in
      // `apikey`. Sent as a bearer alone, Storage tries to parse one as a JWS and refuses it.
      apikey: KEY,
      authorization: `Bearer ${KEY}`,
      "content-type": type,
      "x-upsert": "true",
      // Short: a build must not be served yesterday's words because a CDN still holds them.
      "cache-control": "max-age=60",
    },
    body,
  });
  if (!res.ok) {
    throw new Error(`${key}: ${res.status} ${await res.text()}`);
  }
  console.log(`${key} (${(body.length / 1024).toFixed(1)} KB)`);
}
console.log(`\n${files.length} files are in ${BUCKET}. The next build will fetch them.`);
