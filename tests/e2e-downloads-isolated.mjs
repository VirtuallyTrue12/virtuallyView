// Controlled API fixtures only; never mutates a real download.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  let status = 'downloading';
  let reads = 0;
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/status') return route.fulfill({ json: { authenticated: true, enabled: true, setupRequired: false } });
    if (path === '/api/downloads') {
      reads++;
      return route.fulfill({ json: [
        { id: 'queue-qbittorrent-aabb', title: 'Contract test download', status, progress: 42, sourceClient: 'qbittorrent', actions: ['pause', 'resume', 'remove'] },
        { id: 'queue-sonarr-17', title: 'Series queue record', status: 'downloading', progress: 25, sourceClient: 'sonarr', actions: ['remove'] }
      ] });
    }
    if (path.endsWith('/pause') || path.endsWith('/resume')) {
      status = path.endsWith('/pause') ? 'paused' : 'downloading';
      return route.fulfill({ json: { id: 'queue-qbittorrent-aabb', success: true, message: 'Accepted' } });
    }
    return route.fulfill({ json: {} });
  });
  await page.goto(`${process.env.BASE_URL ?? 'http://127.0.0.1:3101'}/downloads`);
  const row = page.locator('.download-row').filter({ has: page.getByRole('heading', { name: 'Contract test download' }) });
  await row.getByRole('button', { name: 'Pause', exact: true }).click();
  await row.getByRole('button', { name: 'Resume', exact: true }).waitFor();
  assert.equal(await row.getByRole('progressbar').getAttribute('aria-valuenow'), '42');
  assert.ok(reads >= 2, 'Mutation must refetch rather than replace the row with an action response');
  await row.getByRole('button', { name: 'Resume', exact: true }).click();
  await row.getByRole('button', { name: 'Pause', exact: true }).waitFor();
  assert.equal(await row.getByRole('progressbar').getAttribute('aria-valuenow'), '42');
  const series = page.locator('.download-row').filter({ has: page.getByRole('heading', { name: 'Series queue record' }) });
  assert.equal(await series.getByRole('button', { name: 'Pause', exact: true }).count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS: pause/resume refetch retains row title/progress; unsupported controls are absent');
} finally { await browser.close(); }
