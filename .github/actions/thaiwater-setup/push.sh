#!/usr/bin/env bash
# Commit and push pipeline/data (jaga-data) if anything changed. Usage: push.sh "<message>"
set -euo pipefail
cd pipeline/data
git config user.name "jaga-archive-bot"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git add -A
if git diff --cached --quiet; then
  echo "No changes to push."
  exit 0
fi
git commit -q -m "$1"
for attempt in 1 2 3; do
  git pull -q --rebase && git push -q && exit 0
  echo "Push failed (attempt $attempt); retrying in 20 s"
  sleep 20
done
exit 1
