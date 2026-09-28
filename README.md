# Jaga (จากา)

Jaga is a non-profit flood early-warning and emergency-response web app for four provinces in southern Thailand: Pattani, Yala, Narathiwat and Songkhla. The name is Malay for "watch over, take care of", as in *jaga diri, jaga jiran*: take care of yourself, take care of your neighbours.

It helps people:
- see their flood risk and the current alert for their area,
- find the safest places nearby and when to move,
- report flooding and send an SOS,

and helps rescue teams and volunteer admins coordinate without duplicating effort.

**Status:** in development for the 2026 flood season (target go-live 25 October 2026). Not yet in service. In an emergency in Thailand, call **1784** (disaster prevention) or **1669** (medical).

## Safety principles

This is life-safety software. A few rules shape every part of it:
- Nothing ever blocks or delays an SOS. Location is the only required field.
- Only people publish alerts. Code may suggest a level from the data, but never publishes one.
- Forecasts are shown as ranges with their sources and times, never as certainties.
- Exact locations and phone numbers are protected by database row-level security and every reveal is logged.

The full list is in [CLAUDE.md](CLAUDE.md); the functional spec is in [docs/spec.md](docs/spec.md).

## Repository layout

| Path | Contents |
|---|---|
| `docs/` | Functional spec, science plan, brand guide, build plan and decision log |
| `pipeline/` | Python science pipeline (gauge archive, flood mapping, safe-place ranking, thresholds) |
| `public/brand/`, `public/icons/` | Logo and app icons (not covered by the code license, see below) |
The web app (Next.js + Supabase) is being added in phases; see [docs/prompts.md](docs/prompts.md). The gauge data archive is kept in a separate private repository (`nafiscode/jaga-data`), filled by scheduled collectors in the public repo [nafiscode/jaga-collectors](https://github.com/nafiscode/jaga-collectors).

## Getting started

See [SETUP.md](SETUP.md) for a fresh Windows machine.

## Data sources

Gauge and rain data: ThaiWater public API, Hydro-Informatics Institute (HII), Thailand. Further open datasets (Sentinel-1, FABDEM, GSMaP, Open-Meteo/GloFAS, OpenStreetMap) are listed with their uses in [docs/science-plan.md](docs/science-plan.md). Each source's own terms apply to its data.

## License

This repository is private and not yet licensed for reuse. All rights reserved. The Jaga name, the **จากา** wordmark and the logo files in `public/brand/` and `public/icons/` belong to the project.

## Security

See [SECURITY.md](SECURITY.md).

## Contact

Project email: jagaapp.th@gmail.com
