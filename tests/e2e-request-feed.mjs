// Rolling request feed: REAL pipeline events only. A deliberately no-match
// title guarantees real failure-path events with zero library mutations.
// DASH_PASS=... node tests/e2e-request-feed.mjs
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const base = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
assert.ok(process.env.DASH_PASS, 'Set DASH_PASS');
const title = `Zzz No Such Title ${Date.now()}`;
const browser = await chromium.launch();
let context;
try {
  context = await browser.newContext();
  const login = await context.request.post(`${base}/api/auth/login`, {
    data: { username: process.env.DASH_USER ?? 'root', password: process.env.DASH_PASS }
  });
  assert.equal(login.status(), 200);

  // Server contract: events are returned by the API, real and non-empty.
  const created = await context.request.post(`${base}/api/requests`, { data: { title, mediaType: 'movie' } });
  const body = await created.json();
  const request = body.request;
  assert.ok(request, `request creation should return the request: ${JSON.stringify(body).slice(0, 200)}`);
  assert.equal(request.status, 'failed', 'no-match title must fail, not fake progress');
  assert.ok(Array.isArray(request.events) && request.events.length >= 3,
    `expected real pipeline events, got: ${JSON.stringify(request.events)}`);
  assert.ok(request.events.some(event => /Request created/i.test(event.text)));
  assert.ok(request.events.some(event => /metadata identity|no confident/i.test(event.text)),
    'expected a lookup event or no-match event');
  assert.ok(request.events.every(event => event.at && event.text), 'events need timestamps and text');

  // UI renders the rolling feed with the real lines.
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/requests`);
  const card = page.locator('.request-card').filter({ has: page.getByRole('heading', { name: title }) });
  await card.waitFor();
  await card.getByLabel('Request activity').waitFor();
  const lines = await card.locator('.request-activity-line').count();
  assert.ok(lines >= 3, `expected at least 3 activity lines, saw ${lines}`);
  // The feed shows the LATEST events first (creation is behind "Show earlier").
  assert.ok(await card.getByText('Looking up metadata identity').count(), 'lookup event must be visible');
  assert.ok(await card.locator('.status-pill', { hasText: 'failed' }).count(), 'status pill must show failed');
  assert.ok(await card.getByText('Show earlier activity', { exact: false }).count(), 'older events must remain reachable');
  assert.deepEqual(errors, []);
  await context.request.post(`${base}/api/auth/logout`);
  console.log(`PASS: rolling feed rendered ${lines} real events for the failed request (create -> lookup -> failure)`);
} finally {
  if (context) await context.request.post(`${base}/api/auth/logout`).catch(() => {});
  await browser.close();
}
