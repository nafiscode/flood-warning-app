# The channel at each river gauge

What this gives the app: for every river gauge in the four provinces, **how deep the channel is,
how wide, and how high each of its two banks stands** — so the cross-section drawn on a gauge's
card (`components/map/GaugeSection.tsx`) shows that river's own shape instead of one schematic
channel drawn for all of them.

The owner asked for this on 19 Nov 2026: "if we have the river bed and bank width would be nice to
make the illustration of the cross section more realistic … as much as we can, of course no need
to wait for the surveyed data."

## What is measured, and what is not

| Figure | Where it comes from | What it is |
| --- | --- | --- |
| Left bank, right bank (m MSL) | ThaiWater's station record (`left_bank_m`, `right_bank_m`) | The two bank heights the agency lists for that gauge. They differ at 26 of the 52 stations, sometimes by metres: the lower bank is the one the river leaves first. |
| Bed (m MSL) | ThaiWater's station record (`ground_level_m`) | The ground level the agency lists at the station. Thirteen of them are below mean sea level, which is ordinary for an incised channel near the coast. |
| Width (m) | Measured here, across OpenStreetMap's digitised water | The width of the **water surface** OSM's mappers drew, from imagery at an unknown river level. Not the bank-to-bank width, and not a survey. |

**There is no surveyed cross-section**, and this does not invent one. The *shape between* the bed
and the banks is still a drawing — a channel with sloping sides — and the app says so. What is now
real is the depth, the two bank heights, and the width.

**A DEM cannot do this job.** The only elevation data within reach is FABDEM at 30 m. It cannot
resolve a channel 20–50 m wide, and its vertical error of 1 to several metres is the size of the
whole Watch-to-Evacuate band the section is drawn against: a section cut from it would look
authoritative while contradicting the gauge's own levels. The same reasoning the river-body layer
already gives for not deriving width from terrain (`rivers/METHODS.md`).

## How the width is measured

For one station (`width.py`):

1. Find the nearest waterway **centreline** (`waterway=river|canal|stream`) within 150 m. It gives
   the direction of the channel; a station stands on the bank, so its own point cannot.
2. Use only the water **areas** OSM has digitised (`natural=water`, `water=*`,
   `waterway=riverbank`, `landuse=reservoir`). The river-body layer buffers lone centrelines by a
   made-up half-width so narrow channels still show on the map — that is drawing, not measurement,
   so **a station whose river OSM maps only as a line gets no width at all** rather than a width of
   16 m nobody measured. This is why only 17 of the 52 gauges have one.
3. Cast a transect perpendicular to the centreline and take the length of the piece of water the
   point falls in.
4. Repeat at five places 40 m apart along the line and take the **median**, so one junction, one
   jetty or one ox-bow cannot decide the answer. Fewer than three usable transects → no width.

Lengths are corrected for the Web Mercator stretch (1/cos(latitude), 0.65% here), so the metres
are ground metres.

## Honesty rules

- A missing figure stays missing. The app then draws its own channel for that station and says the
  shape is a drawing. Nothing is ever filled in with a plausible-looking default.
- A bed that is not below the lower bank is dropped: those two numbers are then not a channel.
- Nothing here is a level and nothing here can raise one (safety rule 2). The Watch, Warning and
  Evacuate lines on the drawing come from `gauge_levels`, as they did before.
- The width is OpenStreetMap's work: © OpenStreetMap contributors, ODbL, credited where it shows.

## Running it

```
uv run python -m gauge_section run          # heights + widths -> seed 62 and report.md
uv run python -m gauge_section run --no-width   # heights only; does not read the OSM cache
uv run python -m gauge_section one X.67A    # one station, printed, nothing written
```

The width needs the river module's OSM cache (`out/rivers/osm/`); fill it with
`uv run python -m rivers fetch` (free, no account, cached per quarter-degree tile).

Outputs:

- `supabase/seed/62_gauge_channel.sql` — joined to `public.stations` by ThaiWater id, like seed 47.
- `pipeline/gauge_section/report.md` — every station, its figures and any note.
- `out/gauge_section/channels.json` — the same with the measurement details.

Re-runnable: the seed upserts, and a station whose figures have not changed is written the same.
