# Dam release: the path, and how the live figures are graded

S7, `docs/science-plan.md` Module 7. Bang Lang dam (EGAT) on the Pattani River, Yala.
Built 10 Oct 2026. Run with `uv run python -m dam_release geometry` and `… thresholds`.

## What this is, and what it is not

This note covers the **interim** release path and the **grading rules**, which is what the app
shows today. It does **not** contain travel times or arrival ranges: those are steps 2–3 of S7
and have not been measured yet. Nothing in the app therefore says when water will arrive — only
that water has been released, and which tambons the river runs through.

## The path (step 3, interim)

Source: OpenStreetMap, © OpenStreetMap contributors, ODbL. Decided on 10 Oct 2026 as the interim
source, to be compared against the HAND-and-radar zone from S7 steps 2–3 and most likely
replaced. Everything carries `source = 'osm'` in the database so both versions can sit there at
once.

| | |
|---|---|
| Reservoir | 43.0 km², one outer ring and 13 islands (OSM relation 3224558) |
| Outlet channel | 0.31 km (OSM way 1336823769) |
| River to the sea | 134.3 km in 3 mapped ways, mouth at 101.2442 E, 6.9041 N |
| Tributaries | 10, each with ≥ 5 km of mapped network, lower 5 km of each kept |
| Detail | simplified to 10 m |

How the river is found: the walk starts at the mapped channel leaving the dam and follows the
direction each way is drawn in, which for an OSM waterway is the direction of flow. Ways that
meet share a node, so connectivity is exact coordinate equality, with a 30 m tolerance for a
river split across two ways with one node a hair out. Where a junction offers more than one
channel the larger class wins, then the longer line.

Tributaries are ways that *end* on the main stem, so their water runs into the river. The whole
mapped network above each one is measured, and anything under 5 km is left out: it cannot back up
water worth drawing. From the junction the reach is followed back upstream for 5 km — this is the
"lower reaches of the streams that join it" of spec section 15, where a rising main stem backs
water into the tributary instead of letting it drain.

### Limits, to be stated wherever this is drawn

- The line says **where the river runs, not how far the water spreads**. It is not a flood extent
  and not a zone. Anyone outside the line can still be flooded.
- Only the tributaries **somebody has mapped**. OSM has 22 tributaries on a 135 km river, which
  is certainly fewer than exist. A stream that is missing gets no line and no mention.
- **The spillway's own channel is not mapped in OSM.** The spillway is shown as a point, not a
  drawn channel: inventing a line on a safety map would be worse than showing none.
- The **outlet point** is the head of the mapped outlet channel, which is approximately the
  powerhouse tailwater. It is not a surveyed powerhouse position and still needs confirming.
- The dam wall and main spillway positions are the owner's (9 Oct 2026). OSM's own `name:en` for
  the reservoir relation is wrong ("Mae Wat Bypass Road"), so every name shown is ours.

## The grading rules (step 4)

Measured over **108,597 hourly readings, 31 Dec 2011 to 8 Oct 2026** (dam id 50, EGAT, via
ThaiWater). Hourly release and spill are volumes per hour in million m³; × 1e6/3600 gives m³/s.

There is **no probability here, on purpose.** Three releases in fifteen years, no hydraulic model
and hourly gauges cannot produce a calibrated percentage; one would be invented precision
(safety rule 8). The app shows which rule fired, the figures, and when they were read.

### What the record holds

| | |
|---|---|
| Spill above zero | 893 hours, 0.82% of the record — 2014 (439 h, peak 83.3 m³/s), 2015 (340 h, peak 113.1), 2021 (114 h, peak 648.2) |
| Outflow | median 47.0 m³/s; **99th percentile without spill 160.2 m³/s** |
| Storage | max 1,504.7 Mm³; above normal high (1,454.4) for 133 hours in 15 years |
| 6-hour storage rise | 99th percentile 1.13 Mm³/h |
| Inflow | 99th percentile 405.6 m³/s |

The turbine ceiling of 160 m³/s in `config.yaml` was chosen before this was measured and the
99th percentile of outflow without spill came out at 160.2 — so "more water is leaving than the
turbines alone can pass" is a defensible reading of that line.

### The two tiers

Named criteria, from the dam's own figures. The owner's decision of 10 Oct 2026: the lower tier
is shown by the app itself with its disclaimer; the upper tier reaches the admins, who review it
and send the real alarm. Code never publishes an alert (safety rule 2).

- **quiet** — outflow within the turbine range and storage below normal high.
- **watchful** (the app's own quiet notice, no sound, no push) — storage above normal high
  (1,454.4 Mm³), **or** storage rising faster than 4.0 Mm³/h over 6 hours, **or** inflow above
  500 m³/s.
- **releasing** (reaches the admins to review and send) — spill above zero, **or** total outflow
  above 160 m³/s.

### The spike guard

The archive holds plainly impossible single hours: an outflow of **1,944 m³/s with no spill**
(26 Jun 2015, against a record spill peak of 648), an inflow of **6,241 m³/s**, a six-hour
storage rise of **141 Mm³/h**. One of those must not put a notice on anyone's screen or wake an
admin at three in the morning.

So a rule must hold for **two readings in a row** before it grades (`min_consecutive_h: 2`).
Nothing is discarded and no value is declared too big to be true — a lone reading is still shown,
labelled as waiting for the next one, and a release that is really happening confirms itself
within the hour.

What the guard is worth, over the whole record:

| | hours | spells | unconfirmed hours |
|---|---|---|---|
| watchful | 535 | 79 | 775 |
| releasing | 1,614 | 279 | 2,087 |

**473 single readings are held back** — 23% of the raw `releasing` hours were spikes. 279 spells
in fifteen years is about **19 admin notices a year**, concentrated in the November–December
peak; `watchful` is about 5 spells a year.

Thresholds live in `system_settings.dam_grades`, which admins own, so these are starting values,
not constants. Re-run `thresholds` after changing them to see what the change would have cost.

## Still open

- S7 steps 2–3: travel time per reach from the 2014, 2015 and Jan 2021 releases to the EGAT
  (BLGTD01–05) and RID (X.77, X.40A, X.275, X.10A) gauges, then the zone from HAND and the radar
  extents. Until then the app shows no arrival time at all.
- The powerhouse position, and whether the spillway channel should be digitised by hand.
- A contact at EGAT Bang Lang (the owner).
