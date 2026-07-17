#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
node scripts/sync-strava.js
if git diff --quiet -- data/strava-summary.json; then
  echo "No public Strava summary changes to commit."
  exit 0
fi
git add data/strava-summary.json
git commit -m "Update Strava training stats"
git push
