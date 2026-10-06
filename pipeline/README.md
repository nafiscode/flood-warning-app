# Jaga science pipeline

Python 3.11+, managed with [uv](https://docs.astral.sh/uv/). Run everything from this folder.

```powershell
uv sync                 # install dependencies
uv run pytest           # offline tests
```

## r2sync (large outputs to Cloudflare R2)

PMTiles and COG rasters go to R2, not git. Two buckets: `jaga-tiles` (public, served to the app) and `jaga-rasters` (private). Settings are the `R2_*` values in `.env.local` (see `../SETUP.md`, "One-time: Cloudflare R2").

```powershell
uv run python -m r2sync check                                   # can we reach both buckets?
uv run python -m r2sync push out\rp100.pmtiles --bucket public --key hazard/flood-depth-rp100/2026-10-05.pmtiles --dry-run
uv run python -m r2sync push out\rp100.pmtiles --bucket public --key hazard/flood-depth-rp100/2026-10-05.pmtiles
uv run python -m r2sync manifest flood-depth-rp100 hazard/flood-depth-rp100/2026-10-05.pmtiles
uv run python -m r2sync ls --bucket public --prefix hazard/
uv run python -m r2sync manifest --show
```

- Keys are **write-once**: `push` refuses to overwrite. Publish a new version under a new key (use the date), then point `manifest.json` at it. The app reads the manifest (cached 5 min); tile files are cached for a year.
- Allowed prefixes: public `hazard/ extents/ stage/ assets/`; private `dem/ sar/ hazard/ extents/ stage/`.
- Only science outputs go to R2, never user data.
- CORS for `jaga-tiles`: `r2sync/cors-jaga-tiles.json` (paste into the bucket's CORS policy).

## Data

`data/` is not part of this repo: it is a clone of the private repo `nafiscode/jaga-data` (see `../SETUP.md`).

## ingest_thaiwater (S1)

Archives ThaiWater (HII) gauge history for Pattani, Yala, Narathiwat and Songkhla.

```powershell
uv run python -m ingest_thaiwater refresh      # stations, water level, daily rain (since Oct 2023), hourly rain, coverage report
uv run python -m ingest_thaiwater backfill --max-minutes 300   # daily rain back to Oct 2017, resumable
uv run python -m ingest_thaiwater coverage     # rewrite data/reports/coverage.md
uv run python -m ingest_thaiwater snapshot     # zip the archive into data/snapshots/
```

Other commands: `stations`, `waterlevel`, `rain-daily [--since YYYY-MM-DD]`, `rain-hourly`. Settings are in `ingest_thaiwater/config.yaml`.

- Runs are idempotent and resumable (state in `data/state/`). A second run only downloads what's new.
- Requests are paced at 1 per second with retries. Exit code 2 means ThaiWater is down or blocking us.
- Scheduled runs: `.github/workflows/thaiwater-*.yml` (weekly refresh, hourly rain every 12 h, daily backfill until complete, plus a keepalive). They push to jaga-data.

API notes (verified 28 Sep 2026): water level is limited to 365 days per request but older years are reachable; hourly rain exists only for the last ~42 h; daily rain comes in windows of 31 days or less. Endpoint references: [bejranonda/flood2026](https://github.com/bejranonda/flood2026) (MIT) and gain9999/thaiwater (no licence, endpoints only). No code was copied from either.

## hazard (S3, started 6 Oct 2026)

HAND and the hazard baseline. So far: the source rasters, HAND for four candidate stream thresholds, and their comparison with mapped rivers. Method, first results and open points: `hazard/METHODS.md`.

```powershell
uv run python -m hazard sources-export      # FABDEM and JRC water occurrence for 99-103 E, 5-9 N -> Google Drive (a few EECU-minutes)
uv run python -m hazard sources-download    # -> out\hazard\sources
uv run python -m hazard hand                # local, about 10 minutes -> out\hazard\work (finished steps are skipped)
uv run python -m hazard streams-compare     # OpenStreetMap waterways (Overpass, cached) and JRC water -> out\hazard\streams_compare.json
```

- Settings: `hazard/config.yaml`. Outputs: `out/hazard/` (ignored by git).
- OpenStreetMap data is ODbL: credit "© OpenStreetMap contributors" wherever it is shown.
- FABDEM is CC BY-NC-SA 4.0: non-commercial, and what is derived from it (HAND, hazard classes) must carry the same licence and the attribution in the config.
- HAND uses WhiteboxTools through the `whitebox` package, which downloads its binary on first use.

## sar_floods (S2)

Sentinel-1 flood extents in Google Earth Engine: per-scene extents for the two priority events (Nov–Dec 2024 and 2025), the maximum extent of every Oct–Jan season 2017–2025, and the flood frequency. Method, parameters and known issues: `sar_floods/METHODS.md`. First run against Earth Engine on 5–6 Oct 2026 (the Nov–Dec 2024 event; status and compute in the methods note); start with `check` and the dry runs.

One-time: put the Cloud project ID in `.env.local` as `EE_PROJECT`, enable the Earth Engine API and the Google Drive API on that project, then sign in (credentials are stored outside the repo):

```powershell
uv run earthengine authenticate
```

```powershell
uv run python -m sar_floods events                                   # the 9 seasons and 2 priority events (no Earth Engine)
uv run python -m sar_floods check                                    # sign-in, dataset ids, band names
uv run python -m sar_floods run event-2024-nov-dec --dry-run         # scenes, reference per orbit, planned exports; starts nothing
uv run python -m sar_floods run event-2024-nov-dec --dry-run --with-thresholds   # also the Otsu/fallback threshold per tile
uv run python -m sar_floods prepare event-2024-nov-dec               # one asset export per orbit: dry reference + layover mask (wait for these)
uv run python -m sar_floods run event-2024-nov-dec                   # start the Drive exports of ONE event
uv run python -m sar_floods status                                   # task states and EECU-seconds (the quota measurement)
uv run python -m sar_floods download                                 # Drive folder jaga_sar_floods -> out\sar_floods\drive
uv run python -m sar_floods run event-2025-nov-dec
uv run python -m sar_floods run all-seasons                          # one task per season; then status and download again
uv run python -m sar_floods frequency                                # out\sar_floods\products\jaga_sar_frequency_2017-2025_10m_<hash>.tif
uv run python -m sar_floods upload-plan                              # prints the r2sync commands below for every file; runs nothing
```

- Settings: `sar_floods/config.yaml`. `--scale 20` on `run` (and then on `frequency`) quarters the pixel count if the quota is tight.
- Every run writes a log to `out/sar_floods/runs/<UTC time>_<event>.json`: all parameters, the scenes of each pass and of each orbit's dry reference, the threshold per pass, polarisation and tile (Otsu or the fixed drop, and why), and the task ids. `status` adds task states and compute used.
- File names are deterministic: `jaga_sar_scene_<UTC time>_<S1x>_<orbit>_10m_<hash>.tif`, `jaga_sar_max_<event>_10m_<hash>.tif`, `jaga_sar_frequency_<first>-<last>_10m_<hash>.tif`. `<hash>` changes when a processing parameter changes. A second `run` skips exports that an earlier run already started (`--force` overrides).
- Local outputs live in `out/sar_floods/` (ignored by git via the root rule `out/`). They never go into `data/`.
- `prepare` stores each orbit's dry reference and layover mask as an Earth Engine asset (`projects/<EE_PROJECT>/assets/jaga_sar/`); `run` reads a stored reference with the same parameters and computes it inside every request otherwise. The run log says which (`reference.orbits.<orbit>.source`). One `prepare` per season year covers its season and its priority event.
- Exports go to Google Drive only, never Cloud Storage. The area is `sar_floods/aoi.geojson` (the four provinces, simplified; `uv run python -m sar_floods aoi` rebuilds it from `supabase/seed/10_provinces.sql`), sent inline.
- Visual check: paste `sar_floods/code_editor/sar_floods.js` into the Code Editor (one pass at a time, same processing).

After download, upload to the private bucket (write-once keys under `sar/`, dated; `upload-plan` prints one line per file with today's date):

```powershell
uv run python -m r2sync push out\sar_floods\drive\jaga_sar_max_event-2024-nov-dec_10m_cd222f1.tif --bucket private --key sar/max/event-2024-nov-dec_10m_cd222f1/2026-10-06.tif --dry-run
uv run python -m r2sync push out\sar_floods\drive\jaga_sar_max_event-2024-nov-dec_10m_cd222f1.tif --bucket private --key sar/max/event-2024-nov-dec_10m_cd222f1/2026-10-06.tif
uv run python -m r2sync push out\sar_floods\drive\jaga_sar_scene_20241128T2318Z_S1A_D091_10m_cd222f1.tif --bucket private --key sar/scene/20241128T2318Z_S1A_D091_10m_cd222f1/2026-10-06.tif
uv run python -m r2sync push out\sar_floods\products\jaga_sar_frequency_2017-2025_10m_cd222f1.tif --bucket private --key sar/frequency/2017-2025_10m_cd222f1/2026-10-06.tif
uv run python -m r2sync push out\sar_floods\runs\20261006T101500Z_event-2024-nov-dec.json --bucket private --key sar/runs/20261006T101500Z_event-2024-nov-dec.json
uv run python -m r2sync ls --bucket private --prefix sar/
```

(The pass id, run id and date above are examples. `cd222f1` is the hash of the config as committed; `run --dry-run` prints the current one.)
