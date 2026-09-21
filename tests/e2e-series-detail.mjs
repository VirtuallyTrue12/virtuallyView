// Live regression: TV detail must show real Sonarr season/episode data.
// Skips when the TV library is empty (fresh wipe). Optional TEST_SERIES
// overrides which title is checked.
// DASH_PASS=... node tests/e2e-series-detail.mjs
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const base = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
assert.ok(process.env.DASH_PASS, 'Set DASH_PASS');
const browser = await chromium.launch();
let context;
try {
  context = await browser.newContext();
  const login = await context.request.post(`${base}/api/auth/login`, {
    data: { username: process.env.DASH_USER ?? 'root', password: process.env.DASH_PASS }
  });
  assert.equal(login.status(), 200);
  const response = await context.request.get(`${base}/api/series`);
  assert.equal(response.status(), 200);
  const series = await response.json();
  const target = process.env.TEST_SERIES ? series.find(s => s.title === process.env.TEST_SERIES) : series[0];
  if (!target) {
    console.log(`SKIP: ${process.env.TEST_SERIES ? 'requested series not in library' : 'no series in library (wiped fresh)'}`);
  } else {
  const detail = await context.request.get(`${base}/api/series/${encodeURIComponent(target.id)}`);
  assert.equal(detail.status(), 200);
  const seasons = target.seasons ?? [];
  console.log(`Detail seasons for ${target.title}:`, JSON.stringify(seasons.map(s => ({ n: s.number, total: s.episodes, have: s.availableEpisodes ?? 0 }))));
  assert.ok(seasons.length > 0, 'Seasons must come from Sonarr data, not a fabricated single season');
  assert.ok(seasons.every(s => s.number === 0 || s.number >= 1), 'Season numbers must be real');
  assert.ok(seasons.some(s => s.episodes > 0), 'At least one season must have episode totals');
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/series/${encodeURIComponent(target.id)}`);
  await page.getByRole('heading', { name: target.title, exact: true }).waitFor();
  const metaText = await page.locator('.detail-meta').first().innerText();
  assert.match(metaText, /seasons/i);
  assert.match(metaText, /episodes/i);
  assert.doesNotMatch(metaText, /1 seasons/);
  assert.doesNotMatch(metaText, /^0\/0 episodes/);
  const seasonCards = await page.locator('.season-card').count();
  assert.equal(seasonCards, seasons.length);
  assert.deepEqual(errors, []);
  await context.request.post(`${base}/api/auth/logout`);
  console.log(`PASS: ${target.title} renders ${seasons.length} real seasons with available/total episodes`);
  }
} finally { await browser.close(); }

