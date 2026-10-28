# Rivers — the river-body polygon layer

A map layer that shows **where water normally sits**: the rivers, canals, reservoirs and lakes of
the four provinces, as filled polygons. It answers one question — *where is the river?* — and
nothing else. It is **not** a flood extent, not a forecast and never an all-clear (safety rule 10);
it wears the map's water colour, which by rule shows no status.

## Why not the DEM
A DEM gives the drainage *network* (flow accumulation → centrelines) and HAND (height above the
nearest stream), but not the *width* of the water surface. A 30 m elevation model cannot see a
20 m channel, and a flat water surface in a DEM is noise, not a bank. So the river body is drawn
from vector water data, not derived from terrain.

## Source
**OpenStreetMap**, via the public Overpass API (free, no account), the same tooling the safe-places
and dam modules use (`safe_places/osm.py` `_ask`/tile walk, `dam_release/osm.py` way/relation →
polygon). Two kinds of feature are taken:

- **Areas** — `natural=water`, `water=*`, `waterway=riverbank`, `landuse=reservoir` (ways and
  multipolygon relations). These are the digitised water surfaces; they are used as they are.
- **Centrelines** — `waterway=river|canal|stream` lines, for the narrow channels OSM maps only as a
  line. Each is **buffered** by a half-width (river 8 m, canal 4 m, stream 2.5 m; `config.yaml`) so
  it shows as a thin ribbon. This is drawing, not measurement: the true width is unknown.

Coverage in the deep south is uneven, so the buffered centrelines are what guarantee the main
rivers (Pattani, Sai Buri, Kolok, Bang Nara) always appear even where no bank polygon is drawn.

## Pipeline
`uv run python -m rivers fetch` — one Overpass request per 0.25° tile touching the provinces,
cached in `out/rivers/osm/` (re-runnable; finished tiles are skipped).

`uv run python -m rivers build` — areas and buffered lines are unioned in Web Mercator metres
(EPSG:3857, which is also the tiles' projection; the metre is stretched under a percent at this
latitude, immaterial for a context layer), slivers under `min_part_m2` are dropped, and the result
is tiled to one **PMTiles** file (`out/rivers/river-body_<date>.pmtiles`) with the pure-Python
`pmtiles` + `mapbox-vector-tile` builder modelled on `hazard/tiles.py` — no tippecanoe, no external
tools. One layer `river`, zooms 6–13, no properties (every piece is water, one colour). `build`
prints the two `r2sync` commands that publish it.

## Publish
Keys are write-once; a new build gets a new dated key and the manifest is repointed:

```
uv run python -m r2sync push out/rivers/river-body_<date>.pmtiles --bucket public --key hazard/river-body/<date>.pmtiles
uv run python -m r2sync manifest river-body hazard/river-body/<date>.pmtiles
```

The app reads `manifest.json` → `layers["river-body"].key` and draws the layer as the "Rivers" chip
(`lib/river-layer.ts`). The file is small and well inside the R2 free tier.

## Attribution
Data © OpenStreetMap contributors, ODbL. The PMTiles metadata carries the attribution, and the map
credits OpenStreetMap wherever the layer shows.
