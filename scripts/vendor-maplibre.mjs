#!/usr/bin/env node
/**
 * Copy MapLibre's worker files into public/vendor/maplibre/<version>/.
 *
 * MapLibre 6 looks for its worker next to its own module file. After bundling that file no
 * longer exists there, so the app serves the worker itself and points MapLibre at it
 * (lib/map.ts, setWorkerUrl). The version in the path keeps old cached copies from mixing with
 * a new release. Runs after `npm install` and before `dev` and `build`; the folder is not in git.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(repo, "node_modules", "maplibre-gl", "dist");
if (!existsSync(dist)) {
  console.error("maplibre-gl is not installed; run `npm install` first.");
  process.exit(1);
}
const { version } = JSON.parse(
  readFileSync(join(repo, "node_modules", "maplibre-gl", "package.json"), "utf8"),
);
const root = join(repo, "public", "vendor", "maplibre");
rmSync(root, { recursive: true, force: true });
const target = join(root, version);
mkdirSync(target, { recursive: true });
// The worker is a module that imports the shared chunk from the same folder.
for (const file of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  cpSync(join(dist, file), join(target, file));
}
console.log(`MapLibre ${version} worker copied to public/vendor/maplibre/${version}/`);
