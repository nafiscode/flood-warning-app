# Jaga (จากา): brand guide

The app is called **Jaga** (Thai: จากา). The name is Malay for "watch over, take care of", as in *jaga diri, jaga jiran*: take care of yourself, take care of your neighbours.
The logo is the **Sheltered j**: the letter j of Jaga with its dot under a small teal canopy. It reads as a person sheltered by an umbrella, and, gently, as someone watching over them. The tone is **care, not surveillance**. (Chosen on 1 October 2026; it replaces the contour-eye mark. See `docs/decisions.md`.)

## Name and taglines
| Use | Text |
|---|---|
| App name (all languages) | Jaga |
| Thai script | จากา (owner to confirm the spelling with local speakers) |
| Thai tagline | ดูแลกันและกัน |
| Malay tagline | Jaga diri, jaga jiran |
| English tagline | Watch over each other |
| PWA `name` | Jaga – เตือนภัยและขอความช่วยเหลือ |
| PWA `short_name` | Jaga |

## Logo assets (`public/brand/`)
| File | Use |
|---|---|
| `jaga-mark.svg` | Full mark on light backgrounds, 64 px and up |
| `jaga-mark-reverse.svg` | Full mark on the brand slate or other dark backgrounds, 64 px and up |
| `jaga-mark-small.svg` / `-small-reverse.svg` | Heavier mark (wider canopy with three scallops, larger dot, thicker stem) for 16–63 px |
| `jaga-app-icon.svg` | Rounded app icon, for in-app and marketing use |
| `jaga-app-icon-square.svg` | Full-bleed icon source; platforms apply their own corner rounding |
| `jaga-app-icon-shadow.svg` | Laptop and plain PWA icon: the slate square with its shadow, transparent around it |
| `jaga-app-icon-touch.svg` | iPhone and iPad home-screen icon: the full slate tile, shaded light to dark, with a soft shadow under the mark |
| `jaga-app-icon-maskable.svg` | Android home-screen icon (maskable): the same full tile, with the mark inside the 80% safe zone |
| `favicon.svg` | Browser tab |

Ready-made PNGs are in `public/icons/`:
- `icon-192.png` and `icon-512.png`: PWA icons, purpose "any" (from `jaga-app-icon-shadow.svg`)
- `maskable-512.png`: PWA icon, purpose "maskable"
- `apple-touch-icon.png`: 180 px iOS home-screen icon (from `jaga-app-icon-touch.svg`)
- `favicon-32.png`: browser tab fallback

After changing a logo SVG, re-render the PNGs with `npm run icons`.

**Home-screen icons.** The icon someone adds to a phone, tablet or laptop has depth, so it stands off any wallpaper (the owner's request, 12–13 October 2026).
- **Phones and tablets:** the system fills the whole tile and cuts its corners, so nothing can be drawn outside it and the icon is never shrunk onto a surround. The slate fills the tile at the original size, shaded slightly from light at the top (#264B68) through the brand slate to dark at the bottom (#152C3F), with a soft shadow under the mark. This is how store app icons get their depth.
- **Laptops:** the icon is transparent around the slate square, and a soft shadow around the square falls on the desktop or taskbar.
- This shading and these shadows are for the home-screen icons only: not the app header, not the favicon, not the logo anywhere else.

**The mark.** The canopy is teal (`--jaga-teal`; `--jaga-teal-light` on dark backgrounds). The dot and the stem of the j are slate (white on dark backgrounds). The mark files are 84 × 120: taller than wide.

**Lockup.** Build it in code as a `Logo` component, not as an image: the mark, then the wordmark "Jaga" in IBM Plex Sans Thai 700 (letter-spacing -0.01em), with "จากา" underneath at about 35% of the wordmark size.
- **Horizontal lockup:** the mark's height is about 1.7× the wordmark's cap height.
- **Clear space:** about 12% of the mark height on every side.

**Don'ts:**
- Don't recolor the logo in any alert color, and don't place it on an alert-colored background. The dot is never red: it must not look like SOS.
- Don't turn the canopy and dot into a literal eye: no eyelid line, no eyelashes, no blinking or "watching" animation.
- Don't use umbrella icons anywhere else in the UI (including map and weather layers); the umbrella belongs to the logo only.
- Don't use eye icons anywhere in the UI.
- Don't use eye or monitoring language about people ("we are watching you"). The copy is about care and looking out for each other.
- Don't distort it or add effects (shadows, gradients, glows). The one exception is the depth of the home-screen icons, above.

## Color tokens
Implement these as CSS variables and a Tailwind theme. The brand colors must never be used to show a status.

| Token | Hex | Use |
|---|---|---|
| `--jaga-slate` | #1D3B53 | Primary brand, header bar, primary (non-emergency) buttons, logo |
| `--jaga-teal` | #2F9C95 | Accent fills, selected states, logo canopy (not for small text) |
| `--jaga-teal-ink` | #1F7A74 | Teal for text and links on light backgrounds (passes 4.5:1) |
| `--jaga-teal-light` | #7FD1C9 | Accent on dark backgrounds |
| `--jaga-ground` | #F0F2EE | App background |
| `--jaga-surface` | #FFFFFF | Cards, sheets |
| `--jaga-text` | #1A3040 | Body text |
| `--jaga-text-2` | #4A5E68 | Secondary text (passes on ground and surface) |
| `--jaga-line` | #D5DCD8 | Dividers, input borders |

**Alert and status palette: five levels + stale marker.** A0 may adjust these for contrast but must keep each hue. Each level is always shown with its icon and label as well.

| Token | Hex | Text on it | Level |
|---|---|---|---|
| `--alert-normal` | #2F7A25 | white | ปกติ / Normal |
| `--alert-watch` | #F2C230 | #1A1A1A | เฝ้าระวัง / Watch |
| `--alert-warning` | #F07F1A | #1A1A1A | เตือนภัย / Warning |
| `--alert-evacuate` | #C62828 | white | อพยพ / Evacuate |
| `--alert-return` | #1F6FD1 | white | กลับบ้านได้ / Safe to return |
| `--alert-stale` | #6B7780 | white | ไม่ได้อัปเดต / Not updated (marker, not a level) |
| `--sos` | #C62828 | white | SOS button (always paired with the SOS label and icon) |

**Stale is a marker, not a sixth level.** When an alert passes its next-update time, its level badge stays as it is and a grey "not updated since [time]" marker (`--alert-stale`) is added beside it. Never replace or downgrade the level.

**One other thing may wear these hues: the dam's own state** (owner, 12 October 2026; this supersedes "the water colour never changes with the dam's state" of 10 October only for the state chip — the river, the tributaries and the reservoir are still drawn in the water blue). Bang Lang's computed state is shown as a **pill**, not a square-cornered badge, in `--alert-normal` (normal range), `--alert-watch` (worth watching), `--alert-evacuate` (releasing above the normal range) and `--alert-stale` (no figures), on the dam's card, its quiet notice, the war room and the dam's own three marks on the map. It carries an icon and a word like every level does, and the screen it sits on always says in words that these are the dam's published figures and **not an alert from Jaga**, because only a person issues one (safety rule 2). A dam whose feed has gone quiet is grey, never green; a stale reading keeps its colour and gains the grey marker beside it, exactly as an alert does.

**Level icons:**
| Level | Icon |
|---|---|
| Normal | check |
| Watch | backpack (get your go-bag ready) |
| Warning | triangle |
| Evacuate | running person |
| Safe to return | house |
| Stale marker | clock |

No eye icons anywhere in the UI, and no umbrella icons: the umbrella appears only in the logo.

**Light by day, dark after sunset** (owner, 9 October 2026; this supersedes "light theme only" in the MVP). The clock decides and there is nothing to switch: the app works out sunrise and sunset for the area the person chose (`lib/sun.ts`) and sets a dark palette between them. Daylight keeps the light theme, which is what reads outdoors in bright sun; after dark a lit white screen is the wrong thing to hold in a flood at night.

The dark values are in `lib/brand/tokens.ts` (`darkBrand`) and mirrored in `app/globals.css` under `:root[data-theme="dark"]`; a test checks the two agree and that every pair passes contrast. Two roles the slate used to play alone are now separate tokens, equal in the light theme and different after dark: `--jaga-ink` for headings and strong words, `--jaga-edge` for the outline of a button or chip, while `--jaga-slate` stays the filled navy of the header and the primary button.

**The alert palette does not change between the themes.** Those colours mean a level, each badge carries its own background, and both pairs already pass contrast on either page colour.

## Typography
- **Family:** IBM Plex Sans Thai, weights 400, 500 and 700. It covers Thai and Latin, which is enough for Thai, Rumi Malay and English.
- **Jawi:** if Jawi script is chosen for Malay, add an Arabic-script companion font and check that it includes the Jawi-specific letters (ڠ ڤ چ ڽ ݢ ۏ).
- **Scale:** Thai body 18 px/1.6 (never below 16 px, even for secondary text); headings 24/30/40 px at 700; the alert-hero level label at 32–40 px, 700.
- **Numbers and times:** tabular figures where the font supports them.

## Voice and tone
- Calm, clear and caring. Actions come first. Use short sentences and plain words, and no jargon in the user app.
- Thai is the source text; Malay and English follow its meaning, not a word-for-word translation.
- Examples:
  - Say "ย้ายรถไปที่สูงตอนนี้" (move your car to high ground now), not "ระดับความเสี่ยงของท่านอยู่ในเกณฑ์สูง" (your risk level is in the high range).
  - Say "ส่งคำขอแล้ว ทีมช่วยเหลือเห็นคำขอของคุณ" (request sent, the rescue team can see it), not "Request submitted successfully".

## Sound

Jaga makes six sounds and no others. They are generated in the app with the Web Audio API, so there is no audio file to download, nothing to cache and nothing to licence, and they work offline. Short, plain tones; nothing cinematic, no siren samples, no music.

| Sound | When | Shape |
|---|---|---|
| Offer alarm | an authority is being offered an SOS case | a fast two-tone: six short bright notes, high and low in turn (988 and 740 Hz), then a breath, repeating every 1.3 s until the offer is answered or passes on. The only insistent sound in Jaga. Chosen by the owner by ear on 12 Oct 2026 from eighteen candidates. |
| Supply offer | a team is being offered a request for food and water (spec 4.10) | three low, round, unhurried notes (523, 523, 659 Hz), played **once**. Everything the alarm is not: lower than its lowest note, slower, and silent afterwards, so a crew that does both jobs never takes one for the other by ear. Not heard by the owner yet. |
| Accepted | a team accepts the requester's case | one short rising pair. Relief, not celebration. |
| Rescued / safe | "rescued" and "I'm safe now" | three soft notes resolving downward |
| Alert | a new alert at Warning or Evacuate | one low double-tone |
| Dam release | a release notice from Bang Lang (spec 15) reaches someone in the zone downstream | a rising figure, repeated; the only public alert sound that repeats. Never mistakable for the alert double-tone. |

Rules:
- **Watch and Normal are silent.** A level that means "get ready" does not deserve a noise at 3 a.m.
- **Never sound alone.** Every sound has a vibration pattern and its own icon and words on screen (the accessibility rule: a level is never carried by one channel).
- **Audio needs a tap first.** Browsers refuse to play until the person has interacted, so the authority console asks once to arm the alarm and then stays armed. Never assume a sound was heard.
- **An open app rings for a new alert** in the person's area, home or watched places: the Alert tone for Warning and Evacuate, the Dam release figure for a release notice (30 s at most, or until a tap). Once per alert per phone, never on the SOS screens (`lib/use-alert-ring.ts`).
- **A push with the app closed plays the phone's own notification sound.** No web app can replace it; do not design as if it could.
- Nothing in the app plays a sound the person cannot turn off, except the offer alarm for an authority who has armed it.

## Open brand checks (owner)
- Confirm the Thai spelling จากา with local speakers.
- Search the app stores and the Thai trademark register for "Jaga"; check domain availability.
- Test the mark with a few residents from both communities, including elderly people. Show the app icon without the name and ask "What do you see? What would this app do?" If the canopy and dot read as a watching eye or as surveillance, soften it: drop the dot (the plain "j under a canopy") and use the tagline everywhere.
