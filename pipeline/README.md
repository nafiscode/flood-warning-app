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
