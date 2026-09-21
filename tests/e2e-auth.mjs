// Live login lifecycle against the real backend through Vite or the built app.
// BASE_URL=http://127.0.0.1:3101 DASH_PASS=... node tests/e2e-auth.mjs
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const base = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
assert.ok(process.env.DASH_PASS, 'Provide DASH_PASS; this test never creates accounts');
const browser = await chromium.launch();
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let themeRequests = 0;
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/themes/active') themeRequests++; });
  await page.goto(base);
  await page.getByRole('button', { name: 'Sign in', exact: true }).waitFor();
  assert.equal(themeRequests, 0, 'Do not request protected themes before login');
  assert.equal(await page.getByText('Your session expired. Please sign in again.').count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Create first account' }).count(), 0);
  await page.getByPlaceholder('Username', { exact: true }).fill(process.env.DASH_USER ?? 'root');
  await page.getByPlaceholder('Dashboard password', { exact: true }).fill(process.env.DASH_PASS);
  const loadedTheme = page.waitForResponse(response => new URL(response.url()).pathname === '/api/themes/active');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const response = await loadedTheme;
  assert.equal(response.status(), 200);
  const theme = await response.json();
  await page.waitForFunction(vars => Object.entries(vars).every(([key, value]) => document.documentElement.style.getPropertyValue(key) === value), theme.cssVars);
  assert.equal(await page.getByPlaceholder('Dashboard password', { exact: true }).count(), 0);
  const logout = await context.request.post(`${base}/api/auth/logout`);
  assert.equal(logout.status(), 200);
  const protectedResponse = await context.request.get(`${base}/api/integrations`);
  assert.equal(protectedResponse.status(), 401);
  await page.reload();
  await page.getByRole('button', { name: 'Sign in', exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log('PASS: no false expiry/setup, real login, theme applied after login, logout denies access');

  // Backend outage must not be mistaken for a new installation.
  const offline = await context.newPage();
  let failStatus = true;
  await offline.route('**/api/auth/status', route => failStatus
    ? route.fulfill({ status: 503, json: { message: 'Unavailable' } })
    : route.continue());
  await offline.goto(base);
  await offline.getByRole('button', { name: 'Retry connection' }).waitFor();
  assert.equal(await offline.getByRole('button', { name: 'Create account', exact: true }).count(), 0);
  failStatus = false;
  await offline.getByRole('button', { name: 'Retry connection' }).click();
  await offline.getByRole('button', { name: 'Sign in', exact: true }).waitFor();
  console.log('PASS: unavailable auth backend shows Retry, not signup; recovery works');
} finally {
  await browser.close();
}
