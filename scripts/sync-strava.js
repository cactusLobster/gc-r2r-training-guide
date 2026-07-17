#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const CREDS_PATH = process.env.STRAVA_CREDENTIALS_PATH || '/Users/jarvis/_OpenClaw/projects/strava/credentials.json';
const OUT = path.join(REPO, 'data', 'strava-summary.json');
const START = new Date('2026-07-17T00:00:00-07:00');
const TRIP = new Date('2026-10-15T00:00:00-07:00');

function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function writeJson(p, obj) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n'); }
function ymd(d) { return d.toISOString().slice(0, 10); }
function addDays(d, n) { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; }
function weekIndex(date) { return Math.floor((date - START) / (7 * 86400000)) + 1; }
function miles(m) { return +(m / 1609.344).toFixed(2); }
function feet(m) { return Math.round(m * 3.28084); }
function minutes(s) { return Math.round(s / 60); }

async function api(url, opts = {}) {
  const res = await fetch(url, opts);
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : null;
}

async function token(creds) {
  const now = Math.floor(Date.now() / 1000);
  const exp = creds.token_expires_at || creds.expires_at || 0;
  if (creds.access_token && exp > now + 600) return creds.access_token;
  const body = new URLSearchParams({
    client_id: String(creds.client_id),
    client_secret: String(creds.client_secret),
    refresh_token: String(creds.refresh_token),
    grant_type: 'refresh_token'
  });
  const refreshed = await api('https://www.strava.com/oauth/token', { method: 'POST', body });
  creds.access_token = refreshed.access_token;
  creds.refresh_token = refreshed.refresh_token;
  creds.token_expires_at = refreshed.expires_at;
  writeJson(CREDS_PATH, creds);
  return creds.access_token;
}

function classify(a) {
  const sport = String(a.sport_type || a.type || '').toLowerCase();
  const name = String(a.name || '').toLowerCase();
  const trainer = !!a.trainer;
  const isStair = /stair|stepper|stairmaster|climbmill|climb mill|stairs/.test(sport + ' ' + name);
  const isRide = sport.includes('ride') || sport.includes('virtualride') || trainer;
  const isFoot = ['walk','hike','run','trailrun'].some(x => sport.includes(x));
  const isWorkout = sport.includes('workout') || sport.includes('elliptical');
  if (isStair) return 'stairs';
  if (isFoot) return 'foot';
  if (isRide) return 'ride';
  if (isWorkout) return 'cross_training';
  return 'other';
}

function plannedForWeek(w) {
  if (w >= 13) return { cardioDays: 0, hikeMiles: 0, verticalFt: 0, note: 'Trip week' };
  const hikeMiles = [0,5,6,7,6,8,9,10,7,11,12,12,8][w] || 0;
  const verticalFt = [0,500,700,900,700,1200,1500,1800,900,2200,2800,2500,1200][w] || 0;
  return { cardioDays: 4, hikeMiles, verticalFt, note: '' };
}

async function main() {
  const creds = readJson(CREDS_PATH);
  const access = await token(creds);
  const after = Math.floor(START.getTime() / 1000);
  const activities = [];
  for (let page = 1; page <= 10; page++) {
    const url = `https://www.strava.com/api/v3/athlete/activities?after=${after}&per_page=100&page=${page}`;
    const batch = await api(url, { headers: { Authorization: `Bearer ${access}` } });
    if (!Array.isArray(batch) || batch.length === 0) break;
    activities.push(...batch);
    if (batch.length < 100) break;
  }

  const weeks = [];
  for (let w = 1; w <= 13; w++) {
    const start = addDays(START, (w - 1) * 7);
    const end = addDays(start, 6);
    weeks.push({
      week: w, start: ymd(start), end: ymd(end), planned: plannedForWeek(w),
      actual: { cardioDays: 0, cardioMinutes: 0, footMiles: 0, verticalFt: 0, stairMinutes: 0, rideMinutes: 0, crossTrainingMinutes: 0, longestFootMiles: 0, activityCount: 0 },
      flags: []
    });
  }

  const cardioDatesByWeek = new Map();
  for (const a of activities) {
    const start = new Date(a.start_date_local || a.start_date);
    if (start < START) continue;
    const w = weekIndex(start);
    if (w < 1 || w > 13) continue;
    const cat = classify(a);
    const wk = weeks[w - 1];
    const dur = minutes(a.moving_time || a.elapsed_time || 0);
    const distMi = miles(a.distance || 0);
    const elevFt = feet(a.total_elevation_gain || 0);
    wk.actual.activityCount++;
    if (['foot','ride','stairs','cross_training'].includes(cat)) {
      const key = `${w}:${ymd(start)}`;
      cardioDatesByWeek.set(key, true);
      wk.actual.cardioMinutes += dur;
    }
    if (cat === 'foot') {
      wk.actual.footMiles = +(wk.actual.footMiles + distMi).toFixed(2);
      wk.actual.verticalFt += elevFt;
      wk.actual.longestFootMiles = Math.max(wk.actual.longestFootMiles, distMi);
    } else if (cat === 'stairs') {
      wk.actual.stairMinutes += dur;
    } else if (cat === 'ride') {
      wk.actual.rideMinutes += dur;
    } else if (cat === 'cross_training') {
      wk.actual.crossTrainingMinutes += dur;
    }
  }

  for (const wk of weeks) {
    wk.actual.cardioDays = [...cardioDatesByWeek.keys()].filter(k => k.startsWith(wk.week + ':')).length;
    const p = wk.planned, a = wk.actual;
    if (wk.week <= 12) {
      if (a.cardioDays < Math.max(2, p.cardioDays - 1)) wk.flags.push('low_cardio_days');
      if (a.footMiles < p.hikeMiles * 0.6 && a.stairMinutes < 30) wk.flags.push('low_hiking_specific_volume');
      if (a.verticalFt < p.verticalFt * 0.5 && a.stairMinutes < 30) wk.flags.push('low_vertical');
      if (a.longestFootMiles < Math.max(4, p.hikeMiles * 0.7) && wk.week >= 3) wk.flags.push('long_hike_not_met');
    }
  }

  const out = {
    generatedAt: new Date().toISOString(),
    source: 'strava',
    publicNote: 'Sanitized weekly aggregates only. No Strava tokens or GPS routes are published.',
    trainingStart: ymd(START),
    tripStart: ymd(TRIP),
    weeks
  };
  writeJson(OUT, out);
  console.log(`Wrote ${OUT} from ${activities.length} Strava activities`);
}

main().catch(err => { console.error(err.stack || err.message); process.exit(1); });
