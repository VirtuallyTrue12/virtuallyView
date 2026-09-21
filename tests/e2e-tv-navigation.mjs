// Live TV navigation and detail. Skips (does not fail) when the TV library is
// empty - the user intentionally wiped media data; this test still proves the
// series-detail path whenever a series exists.
// BASE_URL=... DASH_PASS=... node tests/e2e-tv-navigation.mjs
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
  if (!series.length) {
    console.log('SKIP: no series in library (wiped fresh); add a series to run this live check');
  } else {
    const target = series[0];
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base);
    const rail = page.getByRole('region', { name: 'TV Shows', exact: true });
    const card = rail.getByRole('link', { name: `View ${target.title}`, exact: true });
    await card.waitFor();
    await card.click();
    await page.waitForURL(url => url.pathname !== '/');
    assert.equal(new URL(page.url()).pathname, `/series/${encodeURIComponent(target.id)}`, 'TV rail card must use the series route');
    await page.getByRole('heading', { name: target.title, exact: true }).waitFor();
    assert.equal(await page.getByText(/No movie found/).count(), 0);
    assert.deepEqual(errors, []);
    console.log(`PASS: Home TV rail -> ${target.title} -> series detail`);
  }
  await context.request.post(`${base}/api/auth/logout`);
} finally {
  await browser.close();
}
