# Method: the coastal gate

Module 10 of `docs/science-plan.md`. Asked for by the owner on 16 October 2026, after a friend in
Narathiwat described the Bang Nara flooding while the sea stood high and the water could not get
out. Driver 3 of the science plan ("the coastal gate") had been named since the first draft but
never measured.

## The question

Three days of rain put the same volume of water in a basin whether the sea is high or low. What
differs is how long it takes to leave. A river drains while the sea is below it, so the thing that
decides whether water leaves or stays is not the high tide but the **low** tide: the floor the
river has to get over. Two things lift that floor together on this coast:

- **Monsoon set-up.** The north-east monsoon blows onshore for days at a time and piles water
  against the shore. This raises the whole sea-level curve, low water included.
- **A collapsing tidal range.** The Gulf of Thailand's tide is largely diurnal, and its range
  varies far more than a semidiurnal coast's. When the range falls to a third of a metre the low
  water barely drops at all.

High mean plus small range is the case where the gate never opens. That is a different thing from
a spring tide, and a spring-tide calendar would miss it: at springs the *low* waters go lower,
which helps a river drain.

## The data

Open-Meteo's marine model, hourly `sea_level_height_msl`, at four river mouths (the three warning
zones' `tide_point` from `thresholds/config.yaml`, plus the Bang Nara mouth, which has no zone).
The archive begins in late 2022 — `2022-10-01` answers nulls and `2022-12-01` answers values — so
the record is the whole record, not a window anyone chose. Hourly ERA5 wind at the same points
comes from Open-Meteo's archive API. Both are cached per mouth and year under `out/coastal_gate/sea/`.

The model snaps each request to the nearest sea cell, a few kilometres offshore of the mouth. The
cell actually used is recorded per mouth in the report and in the seed's `method.grid_point`.

## Splitting the record

The slow (non-tidal) part uses the **Godin filter**: three centred moving means of 24, 24 and 25
hours. This is the standard way to take both the diurnal and the semidiurnal tide out of a
sea-level record. `thresholds/tide.py` splits with a single 25-hour mean, which is enough for the
correlation check it does but passes several centimetres of K1/O1 — and the set-up here is read at
exactly that size, so it needs the sharper filter.

What is left after filtering is called the **set-up**; raw minus set-up is the **tide**.

Per Bangkok day (a day needs 20 of its 24 hours to count): lower low water (`llw`), higher high
water (`hhw`), the range, the mean and the mean set-up. Bangkok days because that is the day an
admin and a resident live in, and because a tidal day here runs roughly with the solar day.

## The reference

Percentiles of `llw` and of the set-up over the **flood-season months only** — October, November,
December, January. A June low water says nothing about December's. 450 season days are in the
archive: three Novembers and four Decembers.

The report also cuts the same figures month by month (kept in the seed's `method.monthly`), because
the gate is above all a December thing.

## What the floods show

Flood windows come from `pipeline/data/event_timeline.csv`, the curated timeline: per zone, the
earliest onset to the latest recession across its districts. The Bang Nara has no rows there — no
warning zone covers Mueang Narathiwat — so it borrows Tak Bai's windows, 20 km along the same shore
in the same water, and the report says so.

At all four mouths, in both the 2024 and the 2025 flood:

- the **low water** stood at the 96th to 99th percentile of season days;
- the **high water** was unremarkable, the 81st to 97th;
- the set-up was at the 94th to 98th.

The one event that was a rain event without a sea component — Hat Yai, 18 December 2025 — sits at
the 78th percentile for low water. That is the negative control, and it is the reason this is built
as a modifier and not as a trigger: the sea distinguishes *how long*, not *whether*.

Four mouths agreeing is weaker evidence than it looks, because set-up is coherent over hundreds of
kilometres of this coast — they are not four independent samples of the sea. They are four
independent samples of *the basins*, which is what matters: the same sea condition accompanied
flooding in Pattani, Kolok, Songkhla and Bang Nara alike.

## The live flag

A day is **shut** when its lowest sea level stays at or over the mouth's low-water p90. The flag is
raised at two shut days in a row: one high day is a tide, several is a gate. The marine forecast
runs 7 days out, far beyond the rain-driven lead time, and `signals_fetch()` already stores 5 days
of it per zone.

Base rate, p90 and two days, over four seasons: 10 to 12 spells per mouth in the season months,
about three a season, one of which is the flood. For a trigger that would be far too noisy. For a
modifier it is the right cost: when it is wrong an admin reads "the water will leave slowly" on a
day when no water needs to leave, and nothing is published either way.

## What this is not

- **Not a gauge.** The modelled sea level sat about 0.7 m off the Pattani tide gauge (A8, 14
  October 2026). Percentiles and anomalies within one series are fair; absolute metres are not, and
  none of these numbers transfers to a staff gauge reading.
- **Not validated against an observed tide here.** ThaiWater lists station 2143 `NR`
  (นราธวาส (บางนรา)) at the Bang Nara mouth, but its water-level endpoint answers zero readings for
  2024, 2025 and 2026. The Thai Hydrographic Department publishes predicted tides for Narathiwat;
  nothing observed is open. This is the first thing to fix if the gate is ever to do more than
  advise.
- **Not enough seasons.** Three Novembers. Re-cut the reference after this season.
- **Not a trigger, ever.** It cannot raise a level and it cannot publish (safety rule 2), and the
  app never shows it to the public as a forecast of certainty (safety rule 8).
- **Not a reason to drop the gauges.** Where a gauge sits in the tide's reach, its own record
  already carries the gate — `safe_return` flags those gauges `tidal`, and that flag stays the
  better evidence where it exists.

## Commands

    cd pipeline
    uv run python -m coastal_gate run    # archive, reference, report, seed 49
    uv run python -m coastal_gate now    # what the live forecast says today, for a look

`run` writes `out/coastal_gate/` (daily.csv, summary.json, report.md), `report.md` beside this file,
and `supabase/seed/49_coastal_gate.sql`.
