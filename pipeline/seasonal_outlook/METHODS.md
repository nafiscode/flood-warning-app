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

## Step 1: a second rainfall record (14 Oct 2026)

ERA5-Land (ECMWF's land reanalysis, about 11 km, daily rain summed to the same five days), 45
seasons, compared with CHIRPS:

| | Agree on the season's rank | Same third | 2024 rank | 2025 rank |
|---|---|---|---|---|
| Season total | 0.86 | 64% | 7th (CHIRPS 5th) | 5th (CHIRPS 7th) |
| Wettest five days | 0.64 | 51% | 2nd (CHIRPS 2nd) | 1st (CHIRPS 1st) |
| Wettest fifteen days | 0.81 | 71% | 5th (CHIRPS 2nd) | 1st (CHIRPS 1st) |

| | CHIRPS | ERA5-Land |
|---|---|---|
| The Pacific and the season total | −0.42 (17%) | −0.47 (22%) |
| The Pacific and the wettest five days | −0.30 (9%) | −0.29 (8%) |
| Trend in the season total, per decade | +14% (chance under 1 in 1,000) | +9% (chance 1 in 100) |
| Trend in the wettest five days, per decade | +3% (no trend shown) | +10% (chance 1 in 12: not shown) |

**What survives:** 2025 and 2024 are the two wettest five-day bursts of the record in both; the
Pacific's link to the season total is the same in both; season totals have risen in both (by 9 to
14% a decade); a rise in the worst bursts is not shown by either.

**The ThaiWater gauges could not be used.** The archive's `rain_daily` values (from ThaiWater's
`rain7d_graph`) behave as running multi-day totals, not daily totals: in 499 station-months of
2025 the day-to-day correlation is 0.84 and only 6% of days are zero (daily rain here has many dry
days and little day-to-day memory), and a month's sum is several times the month's rain in both
CHIRPS and ERA5-Land. Nothing else in the pipeline reads it. To find out before any use: what
`rain7d_graph` returns exactly, and whether ThaiWater has a true daily series for the same stations.

## Step 2: the seasonal forecast models (14 Oct 2026)

NOAA CPC's North American Multi-Model Ensemble (NMME): six models and their mean, each run at the
start of October for November to January, 1991 to 2020 (hindcasts) and 2026 (this year). Free, no
account (CPT text files under ftp.cpc.ncep.noaa.gov/International/nmme). The mean over the six
1-degree cells at 100–102 E, 6–7 N. Each forecast's lean is the third it falls in among that model's
other 29 seasons; each observed season's third likewise. IRI's data library, where these are
usually read, now asks for an account; Copernicus (ECMWF SEAS5) does too. Neither was used.

Hit rate over 30 seasons (CHIRPS / ERA5-Land; chance about 33%):

| Method | Hit rate | Heidke skill | This season |
|---|---|---|---|
| Always say normal | 33 / 30% | 0 | normal |
| The Pacific alone | 37 / 40% | 0.05 / 0.12 | **dry** |
| NMME mean | 43 / 43% | 0.15 / 0.15 | wet, but **above all 30 of its past forecasts** |
| CFSv2 | 20 / 17% | −0.20 / −0.25 | wet, above all 30 |
| CMC1 | 37 / 40% | 0.05 / 0.10 | dry |
| CMC2 | 27 / 27% | −0.10 / −0.10 | wet, above 29 of 30 |
| NASA | 43 / 40% | 0.15 / 0.10 | wet, above 29 of 30 |
| NCAR CCSM4 | 50 / 53% | 0.25 / 0.30 | **normal** |
| NCAR CESM1 | 40 / 37% | 0.10 / 0.05 | dry |

- Nothing here is far from chance. With 30 seasons, 13 hits in 30 happens by luck about one time in
  six; the best single model (CCSM4) is the best of seven, which flatters it.
- **This year the multi-model mean and three of the models forecast more rain than in any or nearly
  any of their 30 past runs**, during the strongest El Niño of the record, which has meant drier
  seasons here. The likeliest reading is that the real-time runs are not comparable with the
  hindcasts they were scored on (model versions and set-ups change); it may also be a real signal.
  Either way their lean cannot be scored, so it is not used.

## Step 3: the outlook (14 Oct 2026)

A method is used only if, on both rainfall records, it beat "always normal" and the Pacific alone,
and this year's forecast lies within its own past range. The outlook shows a lean only when every
usable method agrees.

| Method | Lean | Odds dry / normal / wet | Used |
|---|---|---|---|
| The Pacific alone | dry | 50 / 33 / 17 | yes (beats "always normal", weakly) |
| NCAR CCSM4 | normal | 27 / 46 / 27 | yes |
| All other models | — | — | no (see step 2) |
| **Summary** | **no reliable lean** | — | "The usable methods disagree (dry, normal). Prepare as for any season." |

Odds are what followed in past seasons when the method leaned this way, with one season added to
each third so a small count never reads as certainty. The rows are in the table
`seasonal_outlooks` (admins only; migration `20261014150000_s8_seasonal_outlook`, seed
`supabase/seed/60_seasonal_outlook.sql`), for the signal dashboard to read. Nothing public.

## Step 4: the public version (built 14 Oct 2026, the owner's choice)

The owner chose to show it ("outlook public"), against my recommendation below, which is kept for the record. Built as proposed: a closed fold "Season outlook" under the map on the map page (`components/map/SeasonOutlook.tsx`), fetched only when opened (`/api/public/outlook`, from the function `public_seasonal_outlook()`, which gives visitors the summary, the Pacific's phase and the skill of the methods used; the table stays admins only). Shown until the end of January of its season. The wording is in `messages/*.json` under `map.outlook`.

My recommendation was: **admins only this season.** The skill is close to chance, this year's answer is
"no reliable lean", and a public line saying "drier than usual" during the flood season could be read
as an all-clear. Score this season's outlook in February and decide again before the 2027 season.

If the owner wants it public, my proposal for where and how:

- Once a season, dated, on the map page in a closed fold "Season outlook" under the layers, and
  nowhere else: never on the home screen, in alerts, in notifications, or beside an alert level.
- Plain neutral styling: no alert colour, no blue or green, no weather icon that could read as a
  forecast for today.
- Always three parts: the lean or "no clear lean"; how often such a lean was right here; and "the
  worst floods come from a few days of heavy rain that cannot be foreseen this far ahead. Prepare
  as for any season."

Draft wording for this season (Thai is the source; all three are my drafts):

- **TH:** แนวโน้มฤดูฝน (พ.ย.–ม.ค.) ประกาศ 14 ต.ค. 2569: ยังไม่มีแนวโน้มที่ชัดเจน ภาวะเอลนีโญกำลังแรงในมหาสมุทรแปซิฟิกชี้ว่าฝนอาจน้อยกว่าปกติ แต่การคาดการณ์ระยะฤดูกาลในพื้นที่นี้ถูกต้องเพียงราว 4 ใน 10 ครั้ง และน้ำท่วมรุนแรงมักเกิดจากฝนตกหนักเพียงไม่กี่วัน ซึ่งไม่สามารถคาดการณ์ล่วงหน้าได้ไกลขนาดนี้ โปรดเตรียมพร้อมเหมือนทุกปี การแจ้งเตือนสำหรับพื้นที่ของท่านมาจากผู้ดูแล Jaga และ ปภ.
- **MS:** Tinjauan musim hujan (Nov–Jan), dikeluarkan 14 Okt 2026: tiada kecenderungan yang jelas. El Niño yang kuat di Lautan Pasifik menunjukkan hujan mungkin kurang daripada biasa, tetapi ramalan musim di kawasan ini hanya betul kira-kira 4 kali daripada 10, dan banjir paling teruk datang daripada hujan lebat beberapa hari yang tidak dapat diramal sejauh ini. Bersedialah seperti setiap tahun. Amaran untuk kawasan anda datang daripada pentadbir Jaga dan DDPM.
- **EN:** Rainy-season outlook (Nov–Jan), issued 14 Oct 2026: no clear lean. A strong El Niño in the Pacific points to less rain than usual, but seasonal forecasts have been right here only about 4 times in 10, and the worst floods come from a few days of heavy rain that cannot be foreseen this far ahead. Prepare as for any year. Alerts for your area come from Jaga's admins and from DDPM.

## Not done yet

- This season so far: CHIRPS had no five-day total for October 2026 on the day of the fetch.
- Other drivers: the Indian Ocean Dipole, and within the season the MJO and cold surges.
- ECMWF SEAS5 and the Copernicus multi-system (they need a free Copernicus account: the owner's call).
- Scoring this season's outlook in February, and a monthly update of the outlook in November and
  December (the NMME files are published around the 8th of each month).
- Two to four weeks ahead (extended-range forecasts, the MJO): science plan Module 9 step 5.
- Rain is not flood: the link from a wet season or a wet burst to flooded area (the nine radar
  seasons, the gauges) is not made here.

## Commands

```
uv run python -m seasonal_outlook fetch      # about 2 minutes; needs EE_PROJECT
uv run python -m seasonal_outlook history    # seconds (--source era5 for the second record)
uv run python -m seasonal_outlook fetch --source era5   # about 5 minutes
uv run python -m seasonal_outlook sources    # the records side by side, a few minutes
uv run python -m seasonal_outlook models     # NMME files (about 160 MB, kept locally), scored, about 5 minutes
uv run python -m seasonal_outlook outlook --issued 2026-10-14   # rows + supabase/seed/60_seasonal_outlook.sql
node .claude/local/run-sql.mjs supabase/seed/60_seasonal_outlook.sql seasonal_outlooks   # load (laptop helper)
```
