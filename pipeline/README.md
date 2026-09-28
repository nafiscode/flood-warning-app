# Jaga science pipeline

Python 3.11+, managed with [uv](https://docs.astral.sh/uv/). Run everything from this folder. Modules for S2–S6 (SAR flood extents, HAND and hazard, safe places, thresholds, stage-to-extent) are added here phase by phase.

`data/` is not part of this repo: it is a clone of the private repo `nafiscode/jaga-data` (see `../SETUP.md`). Pull it before analysis: `git -C data pull`.

The ThaiWater gauge archive (S1) is filled by the collectors in the public repo [nafiscode/jaga-collectors](https://github.com/nafiscode/jaga-collectors). They moved there so their scheduled runs don't use this private repo's Actions minutes.
