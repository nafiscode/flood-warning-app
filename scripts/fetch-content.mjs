/**
 * Brings down the content of pages that are *about somebody*, before the build.
 *
 * "Who built Jaga" is the founder's own career and face. The owner decided on 20 Oct 2026 that
 * none of it belongs in this repository, which is public. The page stays public on the site; its
 * source does not live here. So the copy and the pictures sit in the `site-content` bucket on
 * Supabase and this script fetches them into gitignored paths during `prebuild`:
 *
 *   messages/about/<locale>.json  ->  merged into the messages by i18n/request.ts
 *   public/about/*                ->  served by the site exactly as a committed file would be
 *
 * **It fetches at build time, never at request time.** A page on this site must not depend on a
 * bucket answering: this is a flood-warning app, and a slow dependency anywhere in the request
 * path is a slow dependency everywhere. Once the build is done the files are ordinary static
 * files on the CDN.
 *
 * **It never fails the build.** If the bucket is unreachable, or this is a fork with no Supabase
 * at all, the files are simply absent: the About page then has nothing to show and takes itself
 * out of the way (see app/[locale]/about), and every other page is unaffected. Pass
 * JAGA_REQUIRE_CONTENT=1 to make a missing fetch fatal, which the owner's own deploys do.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { envValue } from "./env-local.mjs";

const BASE = (envValue("NEXT_PUBLIC_SUPABASE_URL") ?? "").replace(/\/+$/, "");
const BUCKET = "site-content";
const REQUIRED = envValue("JAGA_REQUIRE_CONTENT") === "1";

/** What to fetch, and where it lands. Paths are relative to the repo root. */
const FILES = [
  ...["th", "ms", "en"].map((l) => [`about/${l}.json`, `messages/about/${l}.json`]),
  ["about/nafis.webp", "public/about/nafis.webp"],
  ...["airbus", "egis", "ilf"].map((n) => [`about/logos/${n}.png`, `public/about/logos/${n}.png`]),
];

async function fetchOne(key, dest) {
  const url = `${BASE}/storage/v1/object/public/${BUCKET}/${key}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const body = Buffer.from(await res.arrayBuffer());
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, body);
  return body.length;
}

if (!BASE) {
  const why = "no NEXT_PUBLIC_SUPABASE_URL";
  if (REQUIRED) throw new Error(`content is required but ${why}`);
  console.log(`content: skipped (${why}); pages that need it will show nothing`);
} else {
  let got = 0;
  const missing = [];
  for (const [key, dest] of FILES) {
    try {
      const n = await fetchOne(key, dest);
      got += 1;
      console.log(`content: ${key} -> ${dest} (${(n / 1024).toFixed(1)} KB)`);
    } catch (error) {
      missing.push(`${key}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (missing.length) {
    const why = `${missing.length} of ${FILES.length} not fetched\n  ${missing.join("\n  ")}`;
    if (REQUIRED) throw new Error(`content is required but ${why}`);
    console.log(`content: ${why}`);
  }
  console.log(`content: ${got} of ${FILES.length} files in place`);
}
