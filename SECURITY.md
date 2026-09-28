# Security policy

Jaga handles emergency requests, exact locations and phone numbers of people in danger. We take reports about its security seriously and are grateful for them.

## Reporting a vulnerability

Report it privately by email: **jagaapp.th@gmail.com**. Please don't post details in issues or chat groups.

Please include:
- what the problem is and where (file, endpoint or page),
- steps to reproduce it,
- what an attacker could do with it (for example read someone's location or phone number, or send a false alert).

## What to expect

- We acknowledge your report within 3 days.
- We tell you our assessment and planned fix within 10 days.
- During the flood season (October to January), issues that could expose personal data, block an SOS or allow a false alert are fixed first, as soon as possible.
- We credit you when the fix is released, unless you prefer not to be named.

## Scope

In scope: this repository's code, database policies (row-level security), and the deployed Jaga web app once it is live.

Out of scope: third-party services Jaga uses (Supabase, Vercel, LINE, ThaiWater, Open-Meteo). Please report those to their owners.

Please test only against your own local setup. Don't test against the live service, and never send test SOS requests or alerts to it: they reach real rescue teams.
