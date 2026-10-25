// Regenerate app/api/geo/provinces/outlines.generated.json: the four province outlines as the
// dissolve (ST_Union) of their tambon polygons, so the province border sits exactly on the tambon
// borders the map draws (the owner, 25 Oct 2026). Read-only; run after the tambon boundaries change:
//   node scripts/gen-province-outlines.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { Client } from "pg";
const env = {};
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const i = line.indexOf("="); if (i>0) env[line.slice(0,i).trim()] = line.slice(i+1).trim().replace(/^["']|["']$/g,"");
}
const db = new Client({ connectionString: env.SUPABASE_DB_URL });
await db.connect();
try {
  const r = await db.query(`
    select p.code, p.name_th, p.name_en,
           extensions.ST_AsGeoJSON(extensions.ST_Union(t.geom_web)) as geom
    from public.tambons t
    join public.provinces p on p.code = t.province_code
    where p.status = 'active'
    group by p.code, p.name_th, p.name_en
    order by p.code`);
  const features = r.rows.map((row) => ({
    type: "Feature",
    geometry: JSON.parse(row.geom),
    properties: { code: row.code, name_th: row.name_th, name_en: row.name_en, kind: "province" },
  }));
  const out = { type: "FeatureCollection", features };
  const path = "app/api/geo/provinces/outlines.generated.json";
  writeFileSync(path, JSON.stringify(out));
  console.log("wrote", path, "provinces:", features.length, "bytes:", JSON.stringify(out).length);
} catch (e) { console.error("FAILED:", e.message); process.exitCode = 1; }
finally { await db.end(); }
