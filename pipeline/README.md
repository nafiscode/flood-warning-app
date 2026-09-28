# Jaga science pipeline

Python 3.11+, managed with [uv](https://docs.astral.sh/uv/). Run everything from this folder.

```powershell
uv sync                 # install dependencies
uv run pytest           # offline tests
```

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
- Scheduled runs: `.github/workflows/thaiwater-*.yml` (weekly refresh, hourly rain every 6 h, daily backfill until complete). They push to jaga-data.

API notes (verified 28 Sep 2026): water level is limited to 365 days per request but older years are reachable; hourly rain exists only for the last ~42 h; daily rain comes in windows of 31 days or less. Endpoint references: [bejranonda/flood2026](https://github.com/bejranonda/flood2026) (MIT) and gain9999/thaiwater (no licence, endpoints only). No code was copied from either.
