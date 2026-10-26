// Regenerate the fly-in's crisp "approach" pictures of the service area (public/intro/*.webp),
// used by playIntro in lib/map.ts so the zoom-in stays sharp while the real tiles are still loading
// (the owner, 27 Oct 2026). Two versions, matching the globe's day and night:
//   region.webp       day   - EOX Sentinel-2 cloudless (the free mosaic the satellite basemap falls back to)
//   region-night.webp night - NASA GIBS VIIRS Black Marble (the same night lights as the globe)
// Both are cut to the box below, then their edges are feathered to transparent so they melt into the
// globe with no hard rectangle. Run from the repo root: `node scripts/gen-intro-region.mjs`.
import { writeFileSync } from "node:fs";

import { chromium } from "playwright";

// The lon/lat box the pictures are cut to; keep in step with INTRO_REGION_BOX in lib/map.ts.
const BOX = { W: 98, E: 104.5, S: 4, N: 10 };
const WIDTH = 2048;
const HEIGHT = Math.round((WIDTH * (BOX.N - BOX.S)) / (BOX.E - BOX.W));
const FEATHER = 0.14; // share of the short side faded to transparent at each edge

const SOURCES = {
  "region.webp": `https://tiles.maps.eox.at/wms?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=s2cloudless-2020&STYLES=&CRS=EPSG:4326&BBOX=${BOX.S},${BOX.W},${BOX.N},${BOX.E}&WIDTH=${WIDTH}&HEIGHT=${HEIGHT}&FORMAT=image/jpeg`,
  "region-night.webp": `https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=VIIRS_Black_Marble&STYLES=&CRS=EPSG:4326&BBOX=${BOX.S},${BOX.W},${BOX.N},${BOX.E}&WIDTH=${WIDTH}&HEIGHT=${HEIGHT}&FORMAT=image/jpeg&TIME=2016-01-01`,
};

const browser = await chromium.launch();
const page = await browser.newPage();
try {
  for (const [name, url] of Object.entries(SOURCES)) {
    const res = await fetch(url);
    const jpeg = Buffer.from(await res.arrayBuffer());
    if (!res.ok || jpeg.length < 5000) throw new Error(`${name}: bad source (${res.status}, ${jpeg.length}b)`);
    // A data URL does not taint the canvas, so the pixels can be read back and feathered.
    const dataIn = `data:image/jpeg;base64,${jpeg.toString("base64")}`;
    const webp = await page.evaluate(
      async ({ dataIn, feather }) => {
        const img = new Image();
        img.src = dataIn;
        await img.decode();
        const W = img.naturalWidth;
        const H = img.naturalHeight;
        const c = document.createElement("canvas");
        c.width = W;
        c.height = H;
        const ctx = c.getContext("2d");
        ctx.drawImage(img, 0, 0);
        const d = ctx.getImageData(0, 0, W, H);
        const a = d.data;
        const m = Math.round(Math.min(W, H) * feather);
        const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
        for (let y = 0; y < H; y++)
          for (let x = 0; x < W; x++) {
            const dist = Math.min(x, W - 1 - x, y, H - 1 - y);
            a[(y * W + x) * 4 + 3] = Math.round(smooth(dist / m) * 255);
          }
        ctx.putImageData(d, 0, 0);
        return c.toDataURL("image/webp", 0.82);
      },
      { dataIn, feather: FEATHER },
    );
    const out = Buffer.from(webp.split(",")[1], "base64");
    writeFileSync(`public/intro/${name}`, out);
    console.log("wrote public/intro/" + name, out.length, "bytes");
  }
} finally {
  await browser.close();
}
