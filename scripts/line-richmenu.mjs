#!/usr/bin/env node
/**
 * The menu under the chat with Jaga's LINE Official Account (A7, spec 4.8): five buttons that
 * are always there, in two rows.
 *
 *   - "My area status": answered in the chat by LINE's free reply, from the person's own places
 *   - "Safe places near me": opens Jaga's home screen, where the nearest safe places are listed
 *   - "Ask for help": opens Jaga's SOS screen; it never sends anything by itself (safety rule 1:
 *     a request is sent from the SOS screen, where the location is taken)
 *   - "Flood Risk Map": opens the map (owner, 15 Oct)
 *   - "Register a response team": opens the team registration, through sign-in (owner, 15 Oct)
 *
 * The everyday three keep the top row at the same size as before; the two newer ones sit under
 * them on the light ground, so the SOS button stays where people have learned it is.
 *
 *   node scripts/line-richmenu.mjs draw          only draw public/line/richmenu-2.png
 *   node scripts/line-richmenu.mjs publish <site> draw, upload to LINE, make it everyone's menu
 *
 * The words are read from messages/th.json (`line.menu*`), Thai first and Malay under it. It uses
 * the Chromium that Playwright installs, and LINE_MESSAGING_CHANNEL_ACCESS_TOKEN from .env.local,
 * which it never prints. Publishing again replaces the earlier menu of the same name.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(repo, "public", "line", "richmenu-2.png");
const NAME = "jaga-main";
const W = 2500;
const H = 1686;
const ROW = 843;
const th = JSON.parse(readFileSync(join(repo, "messages", "th.json"), "utf8")).line;
const ms = JSON.parse(readFileSync(join(repo, "messages", "ms.json"), "utf8")).line;

const esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);

// Brand slate and teal for the two everyday buttons; the SOS red only on SOS, as in the app
// (docs/brand.md: the SOS button wears the alert red, nothing else does).
const icons = {
  status: `<svg viewBox="0 0 24 24" width="170" height="170" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="10" r="2.6"/></svg>`,
  places: `<svg viewBox="0 0 24 24" width="170" height="170" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-5h4v5"/></svg>`,
  sos: `<svg viewBox="0 0 24 24" width="170" height="170" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M5.6 5.6l3.6 3.6M14.8 14.8l3.6 3.6M18.4 5.6l-3.6 3.6M9.2 14.8l-3.6 3.6"/></svg>`,
  map: `<svg viewBox="0 0 24 24" width="170" height="170" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14M15 6v14"/></svg>`,
  unit: `<svg viewBox="0 0 24 24" width="170" height="170" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z"/><path d="M12 9v6M9 12h6"/></svg>`,
};
const panel = (key, title, sub, bg, fg) => `
  <div class="p" style="background:${bg};color:${fg}">
    ${icons[key]}
    <div class="t">${esc(title)}</div>
    <div class="s">${esc(sub)}</div>
  </div>`;

const html = `<!doctype html><html lang="th"><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@500;700&display=block">
<style>
  html,body{margin:0}
  body{width:${W}px;height:${H}px;overflow:hidden;display:flex;flex-direction:column;gap:10px;
    background:#0F1C26;font-family:"IBM Plex Sans Thai",system-ui,sans-serif}
  .row{display:flex;gap:10px;height:${ROW - 5}px}
  .p{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px}
  .t{font-size:84px;font-weight:700;line-height:1.35;text-align:center;white-space:nowrap;margin-top:24px}
  .s{font-size:58px;font-weight:500;opacity:.85;text-align:center}
</style></head><body>
  <div class="row">
  ${panel("status", th.menuStatus, ms.menuStatus, "#1D3B53", "#FFFFFF")}
  ${panel("places", th.menuPlaces, ms.menuPlaces, "#1F7A74", "#FFFFFF")}
  ${panel("sos", th.menuSos, ms.menuSos, "#C62828", "#FFFFFF")}
  </div>
  <div class="row">
  ${panel("map", th.menuMap, ms.menuMap, "#F0F2EE", "#1D3B53")}
  ${panel("unit", th.menuUnit, ms.menuUnit, "#F0F2EE", "#1D3B53")}
  </div>
</body></html>`;

async function draw() {
  mkdirSync(dirname(OUT), { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  await page.setContent(html, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: OUT, type: "png" });
  await browser.close();
  console.log(`Drew ${OUT}`);
}

function token() {
  for (const line of readFileSync(join(repo, ".env.local"), "utf8").split(/\r?\n/)) {
    if (line.startsWith("LINE_MESSAGING_CHANNEL_ACCESS_TOKEN=")) {
      return line
        .slice(line.indexOf("=") + 1)
        .trim()
        .replace(/^["']|["']$/g, "");
    }
  }
  throw new Error("LINE_MESSAGING_CHANNEL_ACCESS_TOKEN is not in .env.local");
}

async function publish(site) {
  if (!/^https:\/\/[a-z0-9.-]+$/.test(site)) {
    throw new Error("Usage: node scripts/line-richmenu.mjs publish https://<site address>");
  }
  const auth = { Authorization: `Bearer ${token()}` };
  const third = Math.floor(W / 3);
  const half = Math.floor(W / 2);
  const menu = {
    size: { width: W, height: H },
    selected: true,
    name: NAME,
    chatBarText: "Jaga",
    areas: [
      {
        bounds: { x: 0, y: 0, width: third, height: ROW },
        action: { type: "postback", data: "status", displayText: th.menuStatus },
      },
      {
        bounds: { x: third, y: 0, width: third, height: ROW },
        action: { type: "uri", uri: `${site}/` },
      },
      {
        bounds: { x: third * 2, y: 0, width: W - third * 2, height: ROW },
        action: { type: "uri", uri: `${site}/sos` },
      },
      {
        bounds: { x: 0, y: ROW, width: half, height: H - ROW },
        action: { type: "uri", uri: `${site}/map` },
      },
      {
        bounds: { x: half, y: ROW, width: W - half, height: H - ROW },
        action: { type: "uri", uri: `${site}/authority/register` },
      },
    ],
  };
  const created = await fetch("https://api.line.me/v2/bot/richmenu", {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify(menu),
  });
  if (!created.ok)
    throw new Error(`LINE refused the menu: ${created.status} ${await created.text()}`);
  const { richMenuId } = await created.json();
  const image = await fetch(`https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "image/png" },
    body: readFileSync(OUT),
  });
  if (!image.ok) throw new Error(`LINE refused the picture: ${image.status} ${await image.text()}`);
  const made = await fetch(`https://api.line.me/v2/bot/user/all/richmenu/${richMenuId}`, {
    method: "POST",
    headers: auth,
  });
  if (!made.ok) throw new Error(`LINE did not make it the menu: ${made.status}`);
  // Earlier menus of the same name are removed, so there is only ever one.
  const list = await (
    await fetch("https://api.line.me/v2/bot/richmenu/list", { headers: auth })
  ).json();
  for (const old of list.richmenus ?? []) {
    if (old.name === NAME && old.richMenuId !== richMenuId) {
      await fetch(`https://api.line.me/v2/bot/richmenu/${old.richMenuId}`, {
        method: "DELETE",
        headers: auth,
      });
    }
  }
  console.log(`The menu is everyone's now (${richMenuId}).`);
}

const [what, site] = process.argv.slice(2);
await draw();
if (what === "publish") await publish(site ?? "");
