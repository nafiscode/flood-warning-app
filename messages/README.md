# UI text

All UI text lives here; components never hardcode strings (CLAUDE.md).

- `th.json` is the source of truth for copy.
- `ms.json` (Patani Malay, Rumi script) is a **draft written on 29 Sep 2026 and not yet reviewed**. It must be checked by Patani Malay speakers before launch, starting with the alert levels, SOS and hotlines.
- `en.json` is the fallback and the language of the dev and admin tools.

Alert text shown to the public comes only from reviewed templates, never from runtime machine translation. A unit test checks that all three files have the same keys.
