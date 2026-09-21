// End-to-end check: login, activate a theme through the real UI, and assert
// the page's CSS variables change without a reload. Run with:
//   npx tsx tests/e2e-theme.mjs
// Requires the Docker stack on 127.0.0.1:3000 and DASH_PASS set.
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const USER = process.env.DASH_USER ?? 'root';
const PASS = process.env.DASH_PASS ?? '';

const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };
const ok = (msg) => console.log(`ok: ${msg}`);

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });

const pw = page.locator('input[type=password]');
if (await pw.count()) {
  const user = page.locator('input.settings-input[placeholder="Username"]');
  if (await user.count()) await user.fill(USER);
  await pw.first().fill(PASS);
  await page.locator('button:has-text("Sign in")').click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(800);
}
ok('logged in');

  const bg = () => page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--color-background').trim()
  );

  await page.goto(`${BASE}/themes`, { waitUntil: 'networkidle' });

  // The /themes page is a marketplace landing; switch to the installed view.
  const installedBtn = page.locator('button:has-text("Installed themes")');
  if (await installedBtn.count()) {
    await installedBtn.click();
    await page.waitForTimeout(800);
  }

  const bgBefore = await bg();
  console.log('background before:', bgBefore || '(unset)');

  // Pick a theme whose tokens differ from the current background.
  const cards = page.locator('.theme-card');
  const count = await cards.count();
  if (!count) fail('no theme cards rendered on /themes');
  let target = null;
  for (let i = 0; i < count; i++) {
    const card = cards.nth(i);
    const btn = card.locator('button:has-text("Activate")').first();
    if (await btn.isVisible().catch(() => false)) { target = { card, btn }; break; }
  }
  if (!target) fail('no Activate button found (all themes active?)');

  const name = await target.card.locator('.theme-card-name').first().textContent();
  console.log('activating:', name?.trim());
  await target.btn.click();
  await page.waitForTimeout(800);

  const bgAfter = await bg();
  console.log('background after:', bgAfter || '(unset)');
  if (!bgAfter) fail('no CSS var applied after activation');
  if (bgAfter === bgBefore && bgBefore !== '') {
    // Distinct themes can legitimately share a background; check accent too.
    const accentAfter = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim());
    const accentBefore = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim());
    if (accentAfter === accentBefore) fail('no CSS variable changed after activation');
  }
  ok(`theme applied live (${name?.trim()})`);

  await page.reload({ waitUntil: 'networkidle' });
  const bgReload = await bg();
  if (bgReload !== bgAfter) fail('theme did not persist across reload');
  ok('theme persists across reload');

  console.log('E2E theme test passed.');
} finally {
  await browser.close();
}
