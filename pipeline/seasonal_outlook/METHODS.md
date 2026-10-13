# Seasonal outlook: what the past says (science plan Module 9)

The owner's question, 14 Oct 2026: can Jaga say whether this season will bring heavy floods like the
last two? This package is the first half of the answer, the evidence from the record. It is not an
outlook and nothing here is shown in the app.

**What can honestly be forecast.** The total rain of a season has some predictability weeks ahead,
mostly through the state of the Pacific (ENSO). The floods that hurt people here come from single
bursts of a few days (a cold surge, a low near Borneo), and those cannot be foreseen more than about
one to two weeks ahead by anyone. So an outlook can tilt the odds of a wet or dry season; it cannot
say whether a flood like Hat Yai's in November 2025 will happen. A dry-leaning outlook is never a
reason to prepare less (safety rules 8 and 10).

## Data

- **Rain:** CHIRPS five-day totals (UCSB Climate Hazards Center, public domain), about 5.5 km, 1981
  to now, averaged over each province and over the four together. Read from Earth Engine with small
  interactive requests. CHIRPS blends satellite estimates with rain gauges; on this coast it is a
  fair guide to totals and weaker on the size of single bursts, and the number of gauges blended in
  has changed over the years, which can bend a trend.
- **The Pacific:** NOAA's Oceanic Niño Index (three-month means). The value used is July to
  September, the newest one known in mid-October. La Niña at or under −0.5, El Niño at or over +0.5.
- **Season:** November to January, named by its first year. 45 complete seasons, 1981 to 2025.
  "Wet third" and "dry third" are set by the seasons 1991 to 2020.

## Results, four provinces together (fetched 14 Oct 2026)

### The last two seasons were exceptional for their bursts, not only for their totals

| | Mean 1991–2020 | Season 2024 | Season 2025 |
|---|---|---|---|
| Season total | 1,020 mm | 1,549 mm (5th of 45) | 1,496 mm (7th) |
| Wettest five days | 183 mm | 378 mm (2nd) | 482 mm (1st) |
| Wettest fifteen days | 380 mm | 695 mm (2nd) | 960 mm (1st) |

The two wettest five-day bursts in 45 years are the last two seasons, in every one of the four
provinces. The third is 2017 (268 mm).

### The Pacific tilts the odds, weakly

| Before the season | Seasons | In the wet third | In the dry third | Median total | Median wettest five days |
|---|---|---|---|---|---|
| La Niña | 8 | 4 | 1 | 1,101 mm | 242 mm |
| Neutral | 28 | 10 | 12 | 930 mm | 194 mm |
| El Niño | 9 | 1 | 5 | 820 mm | 161 mm |

Rank correlation of the index with the season total: −0.42 (45 seasons; chance alone does as well
5 times in 1,000), which is 17% of the differences between seasons. With the wettest five days:
−0.30 (9%, chance 1 in 20). Strongest in Songkhla (−0.50), weakest in Narathiwat (−0.35).
**Both 2024 and 2025 followed a neutral Pacific**: the index gave no hint of either.

The nine El Niño seasons: 1982 (640 mm), 1987 (820), 1991 (631), 1997 (891), 2002 (928), 2004 (506),
2009 (1,073), 2015 (721), 2023 (1,216, the one in the wet third). None had a five-day burst in the
top fifteen of the record.

### This year

July to September 2026: **+2.16**, an El Niño, and stronger at this point of the year than any in
this record (1997: +1.79, 2015: +1.73). On the history above that leans the season towards
drier than normal: about 1 season in 9 like it ended in the wet third, 5 in 9 in the dry third.
Nine seasons is very little to lean on, only two of them were strong, and one of the nine was wet.

### Trend

| | Per decade | 95% range | Chance |
|---|---|---|---|
| Season total | +140 mm (+14%) | +69 to +211 | under 1 in 1,000 |
| Wettest fifteen days | +31 mm (+8%) | 0 to +69 | 1 in 20 |
| Wettest five days | +5 mm (+3%) | −10 to +23 | about 1 in 2: no trend shown |

The first fifteen seasons average 785 mm, the last fifteen 1,200 mm. The seasons have become
wetter in this record, in all four provinces alike. Whether the worst bursts have grown is **not**
shown: the two record years are the last two, but two points do not make a trend. The rise in
totals should be checked against a second rainfall record before it is quoted, because of the
change in gauge numbers behind CHIRPS. Nothing here attributes anything to global warming.

## Not done yet

- A second rainfall record (ERA5-Land or the ThaiWater and TMD gauges) to check the totals, the
  bursts and above all the trend.
- This season so far: CHIRPS had no five-day total for October 2026 on the day of the fetch.
- Other drivers: the Indian Ocean Dipole, and within the season the MJO and cold surges.
- The seasonal forecast models themselves (ECMWF SEAS5 and others), and how well they did here in
  past seasons. That hindcast check is what decides whether an outlook is worth publishing.
- Rain is not flood: the link from a wet season or a wet burst to flooded area (the nine radar
  seasons, the gauges) is not made here.

## Commands

```
uv run python -m seasonal_outlook fetch      # about 2 minutes; needs EE_PROJECT
uv run python -m seasonal_outlook history    # seconds
```
