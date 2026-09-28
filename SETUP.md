# Setting up a fresh Windows laptop for Jaga

For Windows 10/11. Use **PowerShell** for every command below. Where a step says "as administrator", right-click PowerShell and choose *Run as administrator*; otherwise use a normal window.

Keep the code **outside OneDrive** (for example `C:\dev\jaga`). OneDrive sync breaks `node_modules`, the local database and the data archive. Nothing in the repo depends on the folder you choose.

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

## 2. Docker Desktop with WSL2 (needed from phase A0, for `supabase start`)

If this is a managed or work laptop, check with IT first: WSL2 and Docker Desktop need virtualization enabled and may need approval.

1. As administrator, install WSL2, then **restart** the laptop:
   ```powershell
   wsl --install
   ```
2. After the restart, finish the Ubuntu setup window if one opens (pick any username and password).
3. Install Docker Desktop:
   ```powershell
   winget install --id Docker.DockerDesktop -e
   ```
4. Start Docker Desktop. In *Settings → General*, make sure **Use the WSL 2 based engine** is ticked.
5. Check it works:
   ```powershell
   wsl --status
   docker run --rm hello-world
   ```

The Supabase CLI is installed per project with npm in phase A0; there's nothing to install globally.

## 3. Sign in to GitHub

```powershell
gh auth login          # GitHub.com → HTTPS → "Login with a web browser"
gh auth setup-git      # lets git use the same login
gh auth status         # should show: Logged in to github.com account nafiscode
```

## 4. Clone both repos

The data archive (`nafiscode/jaga-data`, private) goes **inside** the app repo, at `pipeline\data`. The app repo ignores that folder.

```powershell
mkdir C:\dev -Force
cd C:\dev
git clone https://github.com/nafiscode/flood-warning-app.git jaga
git clone https://github.com/nafiscode/jaga-data.git jaga\pipeline\data
cd jaga
```

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

Fill in `.env.local` as later phases add variables. It is gitignored; never commit it.

## 6. Set up and test the science pipeline

```powershell
cd pipeline
uv sync            # creates pipeline\.venv with Python 3.11 and the dependencies
uv run pytest -q   # should end with "passed"
uv run python -m ingest_thaiwater coverage   # rewrites data\reports\coverage.md from the archive
cd ..
```

## 7. Open in VS Code

```powershell
winget install --id Microsoft.VisualStudioCode -e   # if not installed
code .
```

Install the Claude Code extension, then continue with the next phase in `docs/prompts.md`.

## Checklist

- [ ] `git`, `node`, `python` (3.11), `uv` and `gh` all print a version
- [ ] `docker run --rm hello-world` works
- [ ] `gh auth status` shows the nafiscode account
- [ ] `C:\dev\jaga` and `C:\dev\jaga\pipeline\data` both exist and `git status` is clean in each
- [ ] `.env.local` exists
- [ ] `uv run pytest -q` passes in `pipeline`

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
