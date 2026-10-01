#!/usr/bin/env node
/**
 * Render the PNG icons in public/icons from the SVG sources in public/brand (docs/brand.md).
 * Run it after changing a logo SVG. It uses the Chromium that Playwright already installs.
 *
 *   node scripts/icons.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");

// [source in public/brand, output in public/icons, size in px, transparent corners]
const ICONS = [
  ["jaga-app-icon-square.svg", "icon-192.png", 192, false],
  ["jaga-app-icon-square.svg", "icon-512.png", 512, false],
  ["jaga-app-icon-maskable.svg", "maskable-512.png", 512, false],
  ["jaga-app-icon-square.svg", "apple-touch-icon.png", 180, false],
  ["favicon.svg", "favicon-32.png", 32, true],
];

const browser = await chromium.launch();
try {
  for (const [source, output, size, transparent] of ICONS) {
    const svg = readFileSync(join(repo, "public", "brand", source), "utf8");
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(
      `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
    );
    await page.screenshot({
      path: join(repo, "public", "icons", output),
      omitBackground: transparent,
    });
    await page.close();
    console.log(`${output} (${size} px) from ${source}`);
  }
} finally {
  await browser.close();
}
