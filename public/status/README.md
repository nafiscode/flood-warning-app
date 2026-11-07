# The status note (`notice.json`)

This file is the one thing the public page **/status** shows. It lives in the repo, not in the
database, so /status still works while Supabase or the consoles are down. See
`docs/runbook.md` → "Static status page".

## How to post a note

1. On github.com, open `public/status/notice.json`, click the pencil, edit it.
2. Commit to `main`. Vercel redeploys in about two minutes and the note shows.
3. **When it's over, set the file back to `{}`.**

When there is nothing to say, the file is exactly:

```json
{}
```

The page then says "Jaga is running normally".

## When something is wrong

```json
{
  "level": "down",
  "since": "2026-11-07T10:00:00Z",
  "message": {
    "th": "ระบบฐานข้อมูลขัดข้อง กำลังแก้ไข คำขอความช่วยเหลือที่ส่งไว้จะถูกเก็บและส่งต่อเมื่อกลับมา",
    "ms": "Pangkalan data terganggu, sedang dibaiki. Permintaan bantuan yang dihantar akan disimpan dan dihantar apabila ia kembali.",
    "en": "The database is down and being fixed. Help requests you send are kept and will go through when it is back."
  }
}
```

- `level`: `"degraded"` (slow / some parts not working) or `"down"` (not working). Any other
  value, or a missing `level`, is treated as "nothing to say".
- `since` (optional): when it started, as UTC in `YYYY-MM-DDTHH:MM:SSZ`. Shown in Bangkok time.
- `message`: your own words per language. Thai is enough on its own; Malay and English fall back
  to Thai if you leave them out. Keep it plain and calm, and **never put a flood alert level in
  it** — this page is about the app, not about the weather (safety rules 3 and 10).

Keep the JSON valid (GitHub's editor warns you if it isn't). If the file can't be read, the page
quietly shows the normal state, so don't rely on a broken file to warn anyone — fix the JSON.
