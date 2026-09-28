# Jaga (จากา): brand guide

The app is called **Jaga** (Thai: จากา). The name is Malay for "watch over, take care of", as in *jaga diri, jaga jiran*: take care of yourself, take care of your neighbours.
The logo is an eye drawn with terrain contour lines: watching over the land and the people on it. The tone is **care, not surveillance**.

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
| `jaga-mark-small.svg` / `-small-reverse.svg` | Simplified mark (outer eye and pupil only) for 16–63 px |
| `jaga-app-icon.svg` | Rounded app icon, for in-app and marketing use |
| `jaga-app-icon-square.svg` | Full-bleed icon source; platforms apply their own corner rounding |
| `jaga-app-icon-maskable.svg` | PWA maskable icon, with the mark inside the 80% safe zone |
| `favicon.svg` | Browser tab |

Ready-made PNGs are in `public/icons/`:
- `icon-192.png` and `icon-512.png`: PWA icons, purpose "any"
- `maskable-512.png`: PWA icon, purpose "maskable"
- `apple-touch-icon.png`: 180 px iOS home-screen icon
- `favicon-32.png`: browser tab fallback

**Lockup.** Build it in code as a `Logo` component, not as an image: the mark, then the wordmark "Jaga" in IBM Plex Sans Thai 700 (letter-spacing -0.01em), with "จากา" underneath at about 35% of the wordmark size.
- **Horizontal lockup:** the mark's height is about 1.7× the wordmark's cap height.
- **Clear space:** at least one pupil diameter (about 12% of the mark width) on every side.

**Don'ts:**
- Don't recolor the logo in any alert color, and don't place it on an alert-colored background.
- Don't animate it as blinking or "watching" (no eyelashes, no pupil tracking).
- Don't use eye or monitoring language about people ("we are watching you"). The copy is about care and looking out for each other.
- Don't distort it or add effects (shadows, gradients, glows).

## Color tokens
Implement these as CSS variables and a Tailwind theme. The brand colors must never be used to show a status.

| Token | Hex | Use |
|---|---|---|
| `--jaga-slate` | #1D3B53 | Primary brand, header bar, primary (non-emergency) buttons, logo |
| `--jaga-teal` | #2F9C95 | Accent fills, selected states, logo pupil (not for small text) |
| `--jaga-teal-ink` | #1F7A74 | Teal for text and links on light backgrounds (passes 4.5:1) |
| `--jaga-teal-light` | #7FD1C9 | Accent on dark backgrounds |
| `--jaga-ground` | #F0F2EE | App background |
| `--jaga-surface` | #FFFFFF | Cards, sheets |
| `--jaga-text` | #1A3040 | Body text |
| `--jaga-text-2` | #4A5E68 | Secondary text (passes on ground and surface) |
| `--jaga-line` | #D5DCD8 | Dividers, input borders |

**Alert and status palette.** A0 may adjust these for contrast but must keep each hue. Each level is always shown with its icon and label as well.

| Token | Hex | Text on it | Level |
|---|---|---|---|
| `--alert-normal` | #2F7A25 | white | ปกติ / Normal |
| `--alert-watch` | #F2C230 | #1A1A1A | เฝ้าระวัง / Watch |
| `--alert-warning` | #F07F1A | #1A1A1A | เตือนภัย / Warning |
| `--alert-evacuate` | #C62828 | white | อพยพ / Evacuate |
| `--alert-return` | #1F6FD1 | white | กลับบ้านได้ / Safe to return |
| `--alert-stale` | #6B7780 | white | ไม่ได้อัปเดต / Not updated |
| `--sos` | #C62828 | white | SOS button (always paired with the SOS label and icon) |

The MVP ships a light theme only, because it is more readable outdoors in bright sun. Dark mode comes later.

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

## Open brand checks (owner)
- Confirm the Thai spelling จากา with local speakers.
- Search the app stores and the Thai trademark register for "Jaga"; check domain availability.
- Test the mark with a few residents from both communities, including elderly people. If it reads as surveillance, soften it: emphasize the contour lines and use the tagline everywhere.
