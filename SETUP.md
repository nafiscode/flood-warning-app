# Setting up a fresh Windows laptop for Jaga

For Windows 10/11. Use **PowerShell** for every command below. Where a step says "as administrator", right-click PowerShell and choose *Run as administrator*; otherwise use a normal window.

Keep the code **outside OneDrive**, on a drive with room to spare (about 5 GB with dependencies and the data archive). The examples use `C:\dev\jaga`, where development happens now. On a laptop with a nearly full C:, use another drive (e.g. `D:\jaga`) and do step 2. OneDrive sync breaks `node_modules` and the data archive. Nothing in the repo depends on the folder or drive you choose.

Moving from an existing machine? Read "Moving to another machine" at the end first.

No Docker is needed: development uses a free Supabase cloud project (see "One-time: the Supabase dev project" below).

## 1. Install the tools

In a normal PowerShell window:

```powershell
winget install --id Git.Git -e
winget install --id OpenJS.NodeJS.LTS -e
winget install --id Python.Python.3.11 -e
winget install --id astral-sh.uv -e
winget install --id GitHub.cli -e
```

Close and reopen PowerShell so the new tools are on your PATH, then check them:

```powershell
git --version       # 2.4x or newer
node --version      # v22.x or newer (LTS)
python --version    # 3.11.x (if this opens the Microsoft Store, use: py -3.11 --version)
uv --version
gh --version
```

## 2. Only if C: is nearly full: move the tool caches to another drive

Skip this if C: has plenty of room (the current development laptop does). Otherwise do it now, before anything downloads packages: npm, uv, pip and Playwright otherwise fill `C:\Users\<you>\AppData` with several GB. Having uv's cache on the same drive as the repo also lets it hard-link packages instead of copying them.

```powershell
# 1. Clear whatever is already cached on C: (errors about an empty cache are fine)
npm cache clean --force
uv cache clean
py -m pip cache purge

# 2. Point every cache at D: (change the drive letter if needed)
New-Item -ItemType Directory -Force D:\cache | Out-Null
npm config set cache D:\cache\npm
[Environment]::SetEnvironmentVariable("UV_CACHE_DIR", "D:\cache\uv", "User")
[Environment]::SetEnvironmentVariable("UV_PYTHON_INSTALL_DIR", "D:\cache\uv-python", "User")
[Environment]::SetEnvironmentVariable("PIP_CACHE_DIR", "D:\cache\pip", "User")
[Environment]::SetEnvironmentVariable("PLAYWRIGHT_BROWSERS_PATH", "D:\cache\ms-playwright", "User")
```

Close **every** PowerShell window and VS Code, then open a new PowerShell and check:

```powershell
npm config get cache              # D:\cache\npm
$env:UV_CACHE_DIR                 # D:\cache\uv
$env:PLAYWRIGHT_BROWSERS_PATH     # D:\cache\ms-playwright
```

The Supabase CLI runs through `npx` from the repo, so it uses the npm cache above; there's nothing to install globally.

## 3. Sign in to GitHub

```powershell
gh auth login          # GitHub.com → HTTPS → "Login with a web browser"
gh auth setup-git      # lets git use the same login
gh auth status         # should show: Logged in to github.com account nafiscode
```

## 4. Clone both repos

The data archive (`nafiscode/jaga-data`, private) goes **inside** the app repo, at `pipeline\data`. The app repo ignores that folder.

```powershell
New-Item -ItemType Directory -Force C:\dev | Out-Null
cd C:\dev
git clone https://github.com/nafiscode/flood-warning-app.git jaga
git clone https://github.com/nafiscode/jaga-data.git jaga\pipeline\data
cd jaga

# Commits in both repos must use the GitHub noreply address, never a personal email
# (decisions, 28 Sep). Set per repo, so your other repos keep their own identity.
foreach ($r in ".", "pipeline\data") {
  git -C $r config user.name "nafiscode"
  git -C $r config user.email "135354913+nafiscode@users.noreply.github.com"
}
git config user.email   # should print the noreply address
```

Belt and braces, once per GitHub account: *GitHub → Settings → Emails* → tick **Keep my email addresses private** and **Block command line pushes that expose my email**. GitHub then refuses any push whose commits carry the private address.

The scheduled GitHub jobs keep jaga-data up to date. Before working with the data, get the latest:

```powershell
git -C pipeline\data pull
```

The raw API responses from the first archive run (28 Sep 2026) are not in git. They are in the jaga-data release `thaiwater-2026-09-28`:

```powershell
gh release download thaiwater-2026-09-28 --repo nafiscode/jaga-data --dir $HOME\Downloads
```

## 5. Environment file

```powershell
Copy-Item .env.example .env.local
```

Fill in `.env.local` as you go: the Supabase and R2 values come from the one-time sections below. It is gitignored; never commit it, and never paste its values into a chat.

## 6. Set up and test the science pipeline

```powershell
cd pipeline
uv sync            # creates pipeline\.venv with Python 3.11 and the dependencies
uv run pytest -q   # should end with "passed"
uv run python -m ingest_thaiwater coverage   # rewrites data\reports\coverage.md from the archive
cd ..
```

## 7. Set up and test the web app

```powershell
npm ci                                  # installs exactly what package-lock.json lists
npx playwright install chromium         # test browser, about 150 MB
npm run lint; npm run typecheck; npm test
npm run test:e2e                        # builds the app and tests it at 360 px, offline included
npm run db:migrations                   # needs .env.local; lists migrations applied on jaga-dev
npm run dev                             # http://localhost:3000 and http://localhost:3000/dev/brand
```

npm may warn that a few packages' install scripts are waiting for approval (`@swc/core`, `unrs-resolver`, `@parcel/watcher`). They work without them; don't approve scripts you haven't checked.

## 8. Open in VS Code

```powershell
winget install --id Microsoft.VisualStudioCode -e   # if not installed
code .
```

Install the Claude Code extension, then continue with the next phase in `docs/prompts.md`.

## Checklist

- [ ] `git`, `node`, `python` (3.11), `uv` and `gh` all print a version
- [ ] `npm config get cache` and `$env:UV_CACHE_DIR` point at the other drive (only if you moved the caches)
- [ ] `gh auth status` shows the nafiscode account; `git config user.email` in both repos prints the noreply address
- [ ] The repo folder (e.g. `C:\dev\jaga`) and its `pipeline\data` both exist and `git status` is clean in each
- [ ] `.env.local` exists, with the Supabase dev project values (and R2 values if you work on the pipeline outputs)
- [ ] `uv run pytest -q` passes in `pipeline`
- [ ] `npm test` and `npm run test:e2e` pass; `npm run db:migrations` lists the applied migrations

---

## One-time: the token for the scheduled data jobs

The workflows in `.github/workflows/thaiwater-*.yml` push to jaga-data with a token stored as the secret `JAGA_DATA_TOKEN`. You only need to create it once, from any machine.

1. Open https://github.com/settings/personal-access-tokens/new (Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token).
2. Name: `jaga-data archive bot`. Expiration: 1 year (set a reminder to renew it).
3. Resource owner: `nafiscode`. Repository access: **Only select repositories** → `nafiscode/jaga-data`.
4. Permissions → Repository permissions → **Contents: Read and write**. Leave everything else as "No access".
5. Generate the token and copy it. Then in PowerShell, in the repo folder:
   ```powershell
   gh secret set JAGA_DATA_TOKEN --repo nafiscode/flood-warning-app
   ```
   Paste the token when asked.
6. Test the jobs:
   ```powershell
   gh workflow run "ThaiWater hourly rain" --repo nafiscode/flood-warning-app
   gh run list --repo nafiscode/flood-warning-app --limit 3
   ```

## One-time: the Supabase dev project

Development runs against a free Supabase cloud project, `jaga-dev`. Create it once, from any machine, under the project account (jagaapp.th@gmail.com). The live app gets its own Supabase Pro project later.

1. Go to https://supabase.com → **Start your project** → sign up **with email** as jagaapp.th@gmail.com (not "Continue with GitHub", so the project belongs to the project account). Confirm the email.
2. Create an organization: name `Jaga`, plan **Free**.
3. **New project**:
   - Name: `jaga-dev`
   - Database password: **Generate a password**, then save it in your password manager. You need it in step 5.
   - Region: **Southeast Asia (Singapore)**
   - Click **Create new project** and wait a minute or two.
4. Copy the API values into `.env.local`:
   - Project URL (*Project Settings → Data API*, `https://<ref>.supabase.co`) → `NEXT_PUBLIC_SUPABASE_URL`
   - The `<ref>` part of that URL → `SUPABASE_PROJECT_REF`
   - *Project Settings → API Keys* → **Publishable key** (`sb_publishable_…`) → `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - Same page → **Secret keys** → reveal/copy the default one (`sb_secret_…`) → `SUPABASE_SECRET_KEY`
5. Click **Connect** (top bar) → **Session pooler** → copy the URI, replace `[YOUR-PASSWORD]` with the database password → `SUPABASE_DB_URL`. Use the session pooler: the direct connection on free projects is IPv6-only and fails on many networks.
6. Don't enable extensions or create tables in the dashboard. Migrations do that (PostGIS included), so the database can always be rebuilt from the repo.

The secret key and the database password bypass RLS. They go only into `.env.local`, never into the repo, a chat, or a `NEXT_PUBLIC_` variable.

**Pausing:** free projects pause after about 7 days without activity, and the app then fails to connect. To restore: Dashboard → the `jaga-dev` project → **Restore project** (takes a few minutes). A project paused for more than 90 days can't be restored, only downloaded as a backup; the migrations and seed rebuild it.

## One-time: LINE sign-in

Sign-in settings live in the LINE and Supabase dashboards, not in migrations, so a rebuilt or new Supabase project needs these steps again. A click-by-click version is in the build tracker ("LINE channels" tab).

1. LINE Developers Console (business login, jagaapp.th@gmail.com): one provider `Jaga` holding a **LINE Login** channel (web app) and the Messaging API channel of the LINE Official Account. Both must be in the same provider, or the LINE user IDs won't match; that choice is permanent. Link the Official Account under *LINE Login channel → Basic settings → Linked LINE Official Account*.
2. Copy the four `LINE_*` values into `.env.local` (names in `.env.example`).
3. *LINE Login channel → LINE Login tab → Callback URL*: `https://<ref>.supabase.co/auth/v1/callback`.
4. Supabase dashboard → *Authentication → Sign In / Providers* → add a custom provider:
   - Provider identifier `line` (the app calls it `custom:line`), display name `LINE`
   - Configuration method **Manual configuration**
   - Issuer URL `https://access.line.me`, discovery URL empty
   - Authorization URL `https://access.line.me/oauth2/v2.1/authorize`
   - Token URL `https://api.line.me/oauth2/v2.1/token`
   - Userinfo URL `https://api.line.me/oauth2/v2.1/userinfo`
   - JWKS URI, if asked: `https://api.line.me/oauth2/v2.1/certs`
   - Client ID and secret: the LINE Login channel ID and secret (watch for the browser auto-filling a saved login here)
   - Scopes `openid, profile`
   - **Allow users without email: on.** LINE gives no email; with it off, sign-in ends in "Error getting user email from external provider".
5. *Authentication → URL Configuration → Redirect URLs*: `http://localhost:3000/**` and the deployed address.
6. Same page, **Site URL**: the deployed address (for `jaga-dev`: `https://jaga-neon.vercel.app`), not Supabase's default `http://localhost:3000`. Supabase sends a sign-in it cannot place there (for one, a LINE sign-in whose state is unknown or already used); the app then shows "sign-in didn't work" instead of a dead page.
6. While the LINE Login channel is in **Developing** status, only LINE accounts with a role on it can sign in ("User need to have developer role" otherwise): *Roles → Invite by email*, role **Tester**, and accept the invitation while logged in as that person's own LINE account. Publishing the channel is a launch step.

## One-time: email for admin sign-in links

Supabase's built-in email only delivers to members of the Supabase organisation, so admin sign-in links for anyone else need custom SMTP. Like the LINE settings, this lives in the dashboard: a rebuilt or new Supabase project needs it again. Free; tested on `jaga-dev` on 6 Oct 2026.

1. Google account of the project email (2-Step Verification on) → https://myaccount.google.com/apppasswords → create an app password named `Jaga Supabase`. It is shown once and goes into the Supabase dashboard only: not `.env.local`, not Vercel, not the chat.
2. Supabase dashboard → *Authentication → Emails → SMTP Settings* → enable custom SMTP: sender email and username = the project email, sender name `Jaga`, host `smtp.gmail.com`, port `465` (or `587`), password = the app password.
3. Invite an admin from the laptop with `npm run admin:invite -- <email>`; the person then asks for the link at `/sign-in` under "For admins". An address that was not invited gets no email, by design.

## One-time: Cloudflare R2 for tiles and rasters

Large pipeline outputs (PMTiles, COG rasters) live in Cloudflare R2, not in git or on the laptop. A click-by-click version is in the build tracker ("Approvals & Cloudflare" tab); in short:

1. Cloudflare dashboard → **R2 Object Storage** → add R2 (asks for a payment method; the free tier covers Jaga). Plain R2 only: no Workers or other paid products.
2. Create two buckets, location hint **Asia-Pacific**, storage class **Standard**:
   - `jaga-tiles`: public. *Settings → Public Development URL → Enable*. Copy the `https://pub-….r2.dev` URL → `NEXT_PUBLIC_TILES_BASE_URL`. Before launch this switches to a custom domain (`tiles.<domain>`).
   - `jaga-rasters`: private. Leave public access off.
3. `jaga-tiles` → *Settings → CORS Policy* → paste the policy from `pipeline/r2sync/cors-jaga-tiles.json`, adding the Vercel and live addresses once they exist.
4. R2 overview → **Manage API tokens** → **Create Account API token**: name `jaga-pipeline`, permission **Object Read & Write**, applied to `jaga-tiles` and `jaga-rasters` only. Copy the Access Key ID, Secret Access Key and S3 endpoint into `.env.local` (`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`; the account ID is the first part of the endpoint → `R2_ACCOUNT_ID`).
5. Check the connection (prints bucket names and object counts, never the keys):
   ```powershell
   cd pipeline
   uv run python -m r2sync check
   ```

## Moving to another machine

Everything that matters is in GitHub or the cloud. A move is: set up the new machine with steps 1–8 above, then recreate the few local files below. Nothing needs to be copied from the old machine except those.

**Recreate these (gitignored, needed to run):**

| File / setting | Where it comes from |
|---|---|
| `.env.local` (repo root) | `Copy-Item .env.example .env.local`, then fill in: Supabase URL, publishable key, secret key and project ref from the Supabase dashboard (*Project Settings → API Keys / Data API*); `SUPABASE_DB_URL` from *Connect → Session pooler* plus the database password from your password manager; R2 values from Cloudflare (account ID and S3 endpoint on the R2 overview, the public URL in `jaga-tiles` settings). R2 secret keys are shown only once: if you didn't save them, create a new `jaga-pipeline` token and delete the old one. |
| `pipeline\data\` | `git clone https://github.com/nafiscode/jaga-data.git pipeline\data` (step 4). The raw API responses from the first archive are in the jaga-data release `thaiwater-2026-09-28`. |
| Git identity | Per-repo `git config user.name/user.email` with the noreply address, in both repos (step 4). Your global git email is not used. |
| GitHub login | `gh auth login` (step 3). |

**Optional, for Claude Code (local notes, not secrets):**

| File | What it is |
|---|---|
| `CLAUDE.local.md` | Handoff notes for the next Claude session. Copy it, or let Claude recreate it from CLAUDE.md and `docs/decisions.md`. |
| `.claude\local\jaga-progress.html` | Source of the build tracker page. The live tracker is online (claude.ai artifact); a new session can read it back from its URL. |
| `%USERPROFILE%\.claude\projects\<repo path>\memory\` | Claude Code's memory for this repo. The folder name follows the repo path (e.g. `c--dev-jaga`); if the path changes, copy the files into the new folder. |

**Rebuilt automatically, never copy:** `node_modules\`, `.next\`, `pipeline\.venv\`, `test-results\`, `next-env.d.ts`, `*.tsbuildinfo`, `supabase\.temp\`, Playwright browsers, the npm/uv/pip caches, `pipeline\data\logs\`, `pipeline\data\snapshots\` and `*.out` logs.

**Nothing to copy, only the keys above:**
- **Supabase `jaga-dev`**: the database lives in the cloud. Its structure is rebuilt from `supabase\migrations` at any time (`npm run db:reset`).
- **Cloudflare R2**: files live in the buckets; the pipeline reaches them with the keys in `.env.local`.
- **Scheduled data jobs**: run on GitHub with the `JAGA_DATA_TOKEN` secret stored there; no local copy exists or is needed.
- **Vercel**: builds from GitHub; its settings live in the Vercel project.

**Keep in your password manager** (these can't be recreated from the repo): the GitHub account and its 2FA backup codes; jagaapp.th@gmail.com; the Supabase account and the `jaga-dev` database password; the Cloudflare account and its 2FA backup codes; the R2 `jaga-pipeline` keys (or plan to recreate the token); a copy of `.env.local` as a secure note.

**Check on the new machine:** the checklist above, then `npm run db:migrations` (Supabase keys work) and `cd pipeline; uv run python -m r2sync check` (R2 keys work).

## Fallback: run the data jobs with Windows Task Scheduler

Use this only if the GitHub jobs fail with exit code 2, which means ThaiWater is blocking GitHub's servers. The script is `pipeline\scripts\thaiwater_refresh.ps1`. It runs one job and pushes the result to jaga-data.

Create the three tasks (normal PowerShell, from the repo folder, laptop must be on at those times):

```powershell
$script = (Resolve-Path pipeline\scripts\thaiwater_refresh.ps1).Path
$ps = "powershell.exe"
schtasks /Create /TN "Jaga ThaiWater weekly"   /SC WEEKLY /D TUE /ST 03:00 /TR "$ps -ExecutionPolicy Bypass -File `"$script`" -Job refresh"
schtasks /Create /TN "Jaga ThaiWater rain 12h" /SC HOURLY /MO 12  /ST 00:17 /TR "$ps -ExecutionPolicy Bypass -File `"$script`" -Job rain-hourly"
schtasks /Create /TN "Jaga ThaiWater backfill" /SC DAILY          /ST 05:40 /TR "$ps -ExecutionPolicy Bypass -File `"$script`" -Job backfill"
```

The times are in the laptop's local time zone. If you use the fallback, disable the GitHub workflows (repo → Actions → workflow → "Disable workflow") so both don't push at once.
