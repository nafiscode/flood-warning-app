#!/usr/bin/env node
/**
 * Render the picture a chat app shows when someone pastes a link to Jaga (Open Graph image,
 * 1200 x 630) into public/og/. Run it after changing the logo or the taglines (docs/brand.md).
 * It uses the Chromium that Playwright already installs.
 *
 *   node scripts/og.mjs
 *
 * The file name carries a version: chat apps keep a link's picture for a long time, so a new
 * picture needs a new name (and the same name in lib/site.ts).
 */
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(repo, "public", "og", "jaga-share-1.png");

// Brand tokens only (docs/brand.md): slate, teal, white. No alert colour: a link preview is not
// a status, and a red or orange card in a family chat would read as an alarm.
const html = `<!doctype html><html lang="th"><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@400;500;700&display=block">
<style>
  html,body{margin:0}
  body{width:1200px;height:630px;overflow:hidden;position:relative;color:#fff;
    font-family:"IBM Plex Sans Thai",system-ui,sans-serif;
    background:radial-gradient(1200px 700px at 18% 0%,#2a5576 0%,#1D3B53 45%,#0F1C26 100%)}
  .glow{position:absolute;left:-140px;top:-160px;width:700px;height:700px;border-radius:50%;
    background:radial-gradient(circle,rgba(127,209,201,.28),rgba(127,209,201,0) 62%)}
  .mark{position:absolute;left:92px;top:96px;width:300px;height:428px;
    filter:drop-shadow(0 18px 30px rgba(0,0,0,.35))}
  .text{position:absolute;left:452px;top:92px;right:60px}
  h1{margin:0;font-size:150px;line-height:1;font-weight:700;letter-spacing:-3px}
  h1 span{font-size:64px;font-weight:500;color:#7FD1C9;letter-spacing:0;margin-left:22px}
  .tag{margin:20px 0 0;font-size:46px;font-weight:700;color:#7FD1C9}
  .tag small{display:block;font-size:28px;font-weight:400;color:#B9CCD6;margin-top:4px}
  .what{margin:34px 0 0;font-size:30px;font-weight:500;line-height:1.35;white-space:nowrap}
  .where{margin:10px 0 0;font-size:26px;color:#B9CCD6}
  svg.waves{position:absolute;left:0;bottom:0;width:1200px;height:104px}
</style></head><body>
  <div class="glow"></div>
  <svg class="waves" viewBox="0 0 1200 150" preserveAspectRatio="none" aria-hidden="true">
    <path d="M0 70 Q75 38 150 70 T300 70 T450 70 T600 70 T750 70 T900 70 T1050 70 T1200 70 V150 H0Z" fill="#2F9C95" opacity=".35"/>
    <path d="M0 96 Q75 66 150 96 T300 96 T450 96 T600 96 T750 96 T900 96 T1050 96 T1200 96 V150 H0Z" fill="#2F9C95" opacity=".55"/>
    <path d="M0 122 Q75 96 150 122 T300 122 T450 122 T600 122 T750 122 T900 122 T1050 122 T1200 122 V150 H0Z" fill="#1F7A74"/>
  </svg>
  <svg class="mark" viewBox="18 0 84 120" aria-hidden="true"><path d="M30 34 C30 17.1 43.2 8 60 8 C76.8 8 90 17.1 90 34 Q82.5 28.3 75 34 Q67.5 28.3 60 34 Q52.5 28.3 45 34 Q37.5 28.3 30 34 Z" fill="#7FD1C9"/><circle cx="60" cy="46" r="6.5" fill="#FFFFFF"/><path d="M60 63 V92 C60 106 50 112 34 110" fill="none" stroke="#FFFFFF" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/></svg>
  <div class="text">
    <h1>Jaga<span>จากา</span></h1>
    <p class="tag">ดูแลกันและกัน<small>Jaga diri, jaga jiran · Watch over each other</small></p>
    <p class="what">เตือนภัยน้ำท่วม · ขอความช่วยเหลือ · ที่ปลอดภัยใกล้คุณ</p>
    <p class="where">ปัตตานี · ยะลา · นราธิวาส · สงขลา</p>
  </div>
</body></html>`;

mkdirSync(dirname(OUT), { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await page.setContent(html, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: OUT });
  console.log(`${OUT} (1200 x 630)`);
} finally {
  await browser.close();
}
