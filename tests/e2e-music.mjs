// Live regression for the music pages against real Lidarr data.
// BASE_URL defaults to the built container; DASH_PASS=... node tests/e2e-music.mjs
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const base = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
assert.ok(process.env.DASH_PASS, 'Set DASH_PASS');
const browser = await chromium.launch();
try {
  const context = await browser.newContext();
  const login = await context.request.post(`${base}/api/auth/login`, {
    data: { username: process.env.DASH_USER ?? 'root', password: process.env.DASH_PASS }
  });
  assert.equal(login.status(), 200);
  const response = await context.request.get(`${base}/api/artists`);
  assert.equal(response.status(), 200);
  const artists = await response.json();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/music`);
  await page.getByRole('heading', { name: 'Music', exact: true }).waitFor();
  if (artists.length) {
    const card = page.getByRole('link', { name: `View ${artists[0].title}`, exact: true });
    await card.waitFor();
    await card.click();
    await page.waitForURL(url => url.pathname.startsWith('/music/'));
    await page.getByRole('heading', { name: artists[0].title, exact: true }).waitFor();
    assert.equal(await page.getByText('Loading artist...').count(), 0);
    assert.doesNotMatch(await page.locator('main').innerText(), /lossless audio support configured/i);
    console.log(`PASS: artist detail renders ${artists[0].title} without lossless claim or stuck loading`);
  } else {
    assert.ok(await page.getByText(/No music found/i).count());
    console.log('PASS: empty music library shows empty state');
  }
  await page.goto(`${base}/albums/does-not-exist`);
  await page.getByText('Albums are not viewable yet').waitFor();
  assert.equal(await page.getByText('Loading album...').count(), 0);
  assert.equal(await page.getByText(/lossless/i).count(), 0);
  assert.deepEqual(errors, []);
  await context.request.post(`${base}/api/auth/logout`);
  console.log('PASS: album route explains unimplemented albums, no false claims or stuck loading');
} finally { await browser.close(); }
