#!/usr/bin/env bash
# Refresh Google Scholar data from a network that Scholar allows (e.g. your own
# laptop) and publish it to the `google-scholar-stats` branch.
#
# GitHub-hosted runners are usually blocked by Scholar (HTTP 403/429), so the
# daily workflow can only preserve the last good data. Run this script whenever
# you want a guaranteed fresh sync:
#
#   ./sync_scholar.sh
#
# Optional: PYTHON=/path/to/python  GOOGLE_SCHOLAR_ID=...  SCHOLAR_HTTP_PROXY=... ./sync_scholar.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
BRANCH="google-scholar-stats"
PYTHON="${PYTHON:-python3}"

cd "$ROOT/google_scholar_crawler"
"$PYTHON" -m pip install -q -r requirements.txt
"$PYTHON" main.py
"$PYTHON" - <<'PY'
import datetime, json, pathlib
path = pathlib.Path('results/sync-status.json')
path.write_text(json.dumps({
    'ok': True,
    'checked_at': datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds'),
    'log_tail': 'Fetched successfully from Google Scholar.'
}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
PY

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cd "$TMP"
git init -q
git remote add origin "$(git -C "$ROOT" remote get-url origin)"
# Preserve whatever is already on the data branch.
if git fetch -q --depth=1 origin "$BRANCH"; then
  git checkout -q -B "$BRANCH" FETCH_HEAD
else
  git checkout -q --orphan "$BRANCH"
fi
cp "$ROOT/google_scholar_crawler/results/"*.json .
git add -A
if git diff --cached --quiet; then
  echo "No data changes."
  exit 0
fi
USER_NAME="$(git -C "$ROOT" config user.name || echo 'Scholar Sync')"
USER_EMAIL="$(git -C "$ROOT" config user.email || echo 'scholar-sync@localhost')"
git -c user.name="$USER_NAME" -c user.email="$USER_EMAIL" \
  commit -q -m "chore: sync Google Scholar data (local)"
git push -q --force origin "HEAD:$BRANCH"
echo "Published fresh Scholar data to $BRANCH."
