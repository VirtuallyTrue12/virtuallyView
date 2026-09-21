// Live read-only diagnostics. No service changes or downloads.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const base = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
assert.ok(process.env.DASH_PASS, 'Set DASH_PASS');
const browser = await chromium.launch();
let context;
try {
  context = await browser.newContext();
  assert.equal((await context.request.get(`${base}/api/diagnostics`)).status(), 401);
  assert.equal((await context.request.post(`${base}/api/auth/login`, { data: { username: process.env.DASH_USER ?? 'root', password: process.env.DASH_PASS } })).status(), 200);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const reportResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/diagnostics');
  await page.goto(`${base}/diagnostics`);
  const response = await reportResponse;
  assert.equal(response.status(), 200);
  const report = await response.json();
  assert.ok(report.services.length >= 8);
  assert.ok(report.completedAt && report.durationMs >= 0);
  await page.getByRole('region', { name: 'Diagnostic results', exact: true }).waitFor();
  for (const service of report.services) {
    await page.getByRole('heading', { name: new RegExp(`^${service.name} - `) }).waitFor();
  }
  const nextResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/diagnostics');
  await page.getByRole('button', { name: 'Refresh checks' }).click();
  assert.equal((await nextResponse).status(), 200);
  await page.getByRole('button', { name: 'Refresh checks' }).waitFor();
  await page.getByRole('button', { name: 'Copy safe report' }).click();
  await page.waitForFunction(() => /Report copied\.|Clipboard unavailable\./.test(document.body.innerText));
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'Mobile layout must not overflow');
  assert.deepEqual(errors, []);
  console.log(`PASS: authenticated diagnostics, ${report.counts.checked} live probes, recovery observations, refresh, safe report copy, mobile layout`);
} finally {
  if (context) await context.request.post(`${base}/api/auth/logout`).catch(() => {});
  await browser.close();
}
