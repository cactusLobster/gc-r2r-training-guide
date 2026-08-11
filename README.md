# Rim-to-Rim Training 2026

Single-page training + nutrition planner for the North Rim → South Rim trip,
Oct 15–18, 2026. Served by GitHub Pages from `index.html`; the Pages deploy
workflow redeploys on every push to `main`.

Tabs: **Plan** (the 13-week program), **Food** (meal templates A–D, GERD rules,
cut→maintenance calendar), **Store** (weekly grocery checklist), **Track**
(Friday check-in + adjustment rules). All personal logging persists in
`localStorage` on the device.

## Strava sync

`data/strava-summary.json` holds sanitized weekly aggregates (no tokens, no GPS
routes). It is produced by `scripts/sync-strava.js` and kept fresh by the
**Strava sync** GitHub Actions workflow
(`.github/workflows/strava-sync.yml`), which runs daily at 05:00
America/Phoenix and commits only when the data changed. Pushing that commit
triggers the Pages deploy, so the live site follows automatically.

### Required repo secrets

Settings → Secrets and variables → Actions:

| Secret | Value |
| --- | --- |
| `STRAVA_CLIENT_ID` | Strava API application client ID |
| `STRAVA_CLIENT_SECRET` | Strava API application client secret |
| `STRAVA_REFRESH_TOKEN` | OAuth refresh token for the athlete |

The values come from the Strava API application (strava.com/settings/api) and
the OAuth flow that authorized it. On this Mac mini they also live in
`~/_OpenClaw/projects/strava/credentials.json`.

If the workflow starts failing with a 400/401 from `oauth/token`, Strava has
rotated or revoked the refresh token: re-authorize the app, update
`STRAVA_REFRESH_TOKEN`, and re-run the workflow. The workflow logs a warning
whenever it notices a rotation.

Manual run: Actions → Strava sync → Run workflow (or
`gh workflow run strava-sync.yml`).

### Fallback: run locally via launchd

If Actions is ever unworkable, `scripts/sync-and-push.sh` does the same job
locally (it needs git push credentials that work without a TTY — the old cron
setup failed exactly there, so prefer `gh auth setup-git` first). Save this as
`~/Library/LaunchAgents/com.gcr2r.strava-sync.plist`, adjusting paths:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.gcr2r.strava-sync</string>
  <key>ProgramArguments</key>
  <array>
    <string>/Users/jarvis/_OpenClaw/agents/jarvis/projects/gc-r2r-training-guide/scripts/sync-and-push.sh</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>5</integer><key>Minute</key><integer>0</integer></dict>
  <key>StandardOutPath</key>
  <string>/Users/jarvis/_OpenClaw/agents/jarvis/projects/gc-r2r-training-guide/strava-sync.log</string>
  <key>StandardErrorPath</key>
  <string>/Users/jarvis/_OpenClaw/agents/jarvis/projects/gc-r2r-training-guide/strava-sync.log</string>
</dict>
</plist>
```

Then `launchctl load ~/Library/LaunchAgents/com.gcr2r.strava-sync.plist`.
Don't run both the workflow and a local scheduler at the same time — the local
clone will fall behind the bot's pushes and its own pushes will be rejected.
