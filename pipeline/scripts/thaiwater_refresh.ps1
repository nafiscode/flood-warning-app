# Fallback for the GitHub Actions jobs, only if ThaiWater blocks GitHub's servers.
# Runs one archive job on this machine and pushes pipeline/data to jaga-data.
# All paths are relative to this script; see SETUP.md ("Task Scheduler fallback").
#
#   powershell -ExecutionPolicy Bypass -File pipeline\scripts\thaiwater_refresh.ps1 -Job refresh
#   Jobs: refresh (weekly), rain-hourly (every 12 h), backfill (daily)

param(
    [ValidateSet("refresh", "rain-hourly", "backfill")]
    [string]$Job = "refresh"
)

$ErrorActionPreference = "Stop"
$pipeline = Split-Path -Parent $PSScriptRoot
$data = Join-Path $pipeline "data"

Set-Location $pipeline
git -C $data pull --rebase --quiet

$extra = @()
if ($Job -eq "backfill") { $extra = @("--max-minutes", "300") }
uv run python -m ingest_thaiwater $Job @extra
$code = $LASTEXITCODE

git -C $data add -A
git -C $data diff --cached --quiet
if ($LASTEXITCODE -ne 0) {
    $stamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mmZ")
    git -C $data commit --quiet -m "$Job (local fallback) $stamp"
    git -C $data push --quiet
}
exit $code
