/**
 * Browser tests: a real server (empty data folder, no media services) driven by Chromium.
 * Needs the web app built first (npm run build) and Playwright's Chromium
 * (npx playwright install chromium).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const root = process.cwd();
let server: ChildProcess;
let base = '';
let dataDir = '';
let browser: Browser;
let ctx: BrowserContext;
let page: Page;
const errors: string[] = [];

const freePort = () => new Promise<number>(res => {
  const s = createServer();
  s.listen(0, () => { const { port } = s.address() as { port: number }; s.close(() => res(port)); });
});

async function waitFor(url: string) {
  const end = Date.now() + 60_000;
  while (Date.now() < end) {
    try { if ((await fetch(url)).ok) return; } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 300));
  }
  throw new Error('server did not start');
}

beforeAll(async () => {
  if (!existsSync(resolve(root, 'apps/web/dist/index.html'))) throw new Error('Run "npm run build" first.');
  dataDir = mkdtempSync(join(tmpdir(), 'vv-browser-'));
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  server = spawn(resolve(root, 'node_modules/.bin/tsx'), ['src/index.ts'], {
    cwd: resolve(root, 'apps/server'),
    env: { ...process.env, PORT: String(port), VV_DATA_DIR: dataDir, VV_NO_RESTART: '1', NODE_ENV: 'production' },
    stdio: 'ignore'
  });
  await waitFor(`${base}/api/health`);
  browser = await chromium.launch();
  ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
}, 120_000);

afterAll(async () => {
  await browser?.close();
  server?.kill('SIGKILL');
  rmSync(dataDir, { recursive: true, force: true });
});

const signIn = async (user: string, pass: string) => {
  await page.goto(base + '/');
  await page.locator('input').first().fill(user);
  await page.locator('input[type=password]').first().fill(pass);
  await page.getByRole('button', { name: /^sign in$/i }).last().click();
  await page.waitForSelector('.user-menu-button');
};

describe('first run and accounts', () => {
  it('creates the administrator on first visit', async () => {
    await page.goto(base + '/');
    await page.getByText(/create administrator|set up your server/i).first().waitFor();
    await page.locator('input').first().fill('owner');
    const pw = page.locator('input[type=password]');
    await pw.nth(0).fill('ownerpass');
    await pw.nth(1).fill('ownerpass');
    await page.getByRole('button', { name: /create administrator/i }).click();
    await page.waitForSelector('.user-menu-button, .onboarding, [class*=onboard]', { timeout: 20_000 });
    await ctx.request.post(`${base}/api/onboarding`, { data: { complete: true } });
    await page.goto(base + '/');
    await page.waitForSelector('.user-menu-button');
    expect(await page.locator('.user-menu-button').innerText()).toMatch(/owner/);
  });

  it('shows the setup checklist while nothing is connected', async () => {
    await page.goto(base + '/');
    await page.getByText('Finish setting up').waitFor();
    expect(await page.getByText('Places to search').isVisible()).toBe(true);
    expect(await page.getByRole('button', { name: 'Set up for me' }).isVisible()).toBe(true);
  });

  it('the More menu closes on outside click, Escape and on choosing a page', async () => {
    await page.goto(base + '/movies');
    const more = page.getByRole('button', { name: /^More/ });
    const menu = page.getByRole('menu');

    await more.click();
    await menu.waitFor();
    await page.mouse.click(640, 600);
    await menu.waitFor({ state: 'detached' });

    await more.click();
    await menu.waitFor();
    await page.keyboard.press('Escape');
    await menu.waitFor({ state: 'detached' });

    await more.click();
    await page.getByRole('menuitem', { name: 'Themes' }).click();
    await page.waitForURL(/\/themes$/);
    expect(await menu.count()).toBe(0);
    await page.locator('.nav-more-button.active').waitFor({ timeout: 3000 });
  });

  it('explains a too-short username in plain words', async () => {
    await page.goto(base + '/settings?cat=users');
    await page.getByText('Add an account').waitFor();
    await page.getByPlaceholder('Username').fill('ab');
    await page.getByPlaceholder('At least 4 characters').last().fill('abcd');
    await page.getByRole('button', { name: /create account/i }).click();
    await page.getByText(/username must be at least 3 characters/i).waitFor();
  });

  it('changes the password, signs out and signs back in with the new one', async () => {
    await page.goto(base + '/account');
    await page.getByLabel('Current password').fill('ownerpass');
    await page.getByLabel('New password').fill('newerpass');
    await page.getByRole('button', { name: 'Change password' }).click();
    await page.getByText(/password changed/i).waitFor();
    await page.locator('.user-menu-button').click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await page.waitForSelector('input[type=password]');
    expect((await ctx.request.get(`${base}/api/movies`)).status()).toBe(401);
    await signIn('owner', 'newerpass');
  });
});

describe('appearance', () => {
  it('applies a theme instantly and keeps it after a reload', async () => {
    await page.goto(base + '/themes');
    await page.locator('.theme-tile', { hasText: 'Cyberpunk' }).getByRole('button', { name: /^Use/ }).click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'cyberpunk');
    await page.reload();
    await page.waitForSelector('.theme-tile');
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('cyberpunk');
    await page.locator('.theme-tile').filter({ has: page.getByRole('heading', { name: 'Default', exact: true }) }).getByRole('button', { name: /^Use/ }).click();
  });

  it('saves a created theme and removes it again', async () => {
    await page.goto(base + '/themes/create');
    await page.getByLabel(/^Name/).fill('browser-test');
    await page.getByRole('button', { name: 'Save theme' }).click();
    await page.waitForURL('**/themes');
    await page.locator('.theme-tile', { hasText: 'browser-test' }).waitFor();
    await page.locator('.theme-tile', { hasText: 'browser-test' }).getByRole('button', { name: 'Remove' }).click();
    await page.waitForFunction(() => ![...document.querySelectorAll('.theme-tile')].some(t => t.textContent?.includes('browser-test')));
  });
});

describe('notifications and backup', () => {
  it('rings the bell when someone signs up and clears it when read', async () => {
    await ctx.request.post(`${base}/api/server-settings`, { data: { allowSignup: true } });
    const other = await fetch(`${base}/api/auth/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'guest1', password: 'guestpass' }) });
    expect(other.status).toBe(200);
    await ctx.request.post(`${base}/api/server-settings`, { data: { allowSignup: false } });
    await page.goto(base + '/');
    await page.waitForSelector('.bell-count', { timeout: 30_000 });
    await page.locator('.bell-button').click();
    await page.getByText('guest1 created an account').waitFor();
    await page.getByRole('button', { name: 'Mark all read' }).click();
    await page.waitForSelector('.bell-count', { state: 'detached' });
  });

  it('creates a backup you can download', async () => {
    await page.goto(base + '/settings?cat=backup');
    await page.getByRole('button', { name: 'Back up now' }).click();
    await page.getByRole('link', { name: 'Download' }).first().waitFor();
    const href = await page.getByRole('link', { name: 'Download' }).first().getAttribute('href');
    const res = await ctx.request.get(base + href!);
    expect(res.status()).toBe(200);
    expect((await res.body()).length).toBeGreaterThan(200);
  });
});

describe('empty library pages', () => {
  it('render without errors and without a wall of nothing', async () => {
    for (const path of ['/movies', '/series', '/music', '/requests', '/downloads', '/search']) {
      await page.goto(base + path);
      await page.waitForSelector('main');
      expect((await page.locator('main').innerText()).length).toBeGreaterThan(20);
    }
    expect(errors).toEqual([]);
  });
});

describe('refresh button', () => {
  it('sits in the top bar of every page, reloads the page you are on, and is absent while playing', async () => {
    for (const path of ['/', '/movies', '/requests', '/settings', '/wiki']) {
      await page.goto(base + path);
      await page.waitForSelector('.refresh-button');
    }
    // It asks the server to refresh, and the page fetches its data again.
    await page.goto(base + '/requests');
    await page.waitForSelector('.refresh-button');
    const seen: string[] = [];
    page.on('request', r => { if (/\/api\/(refresh|requests)(\?|$)/.test(r.url())) seen.push(`${r.method()} ${new URL(r.url()).pathname}`); });
    await page.locator('.refresh-button').click();
    await page.waitForSelector('.refresh-button:not(.is-busy)');
    expect(seen).toContain('POST /api/refresh');
    expect(seen).toContain('GET /api/requests');
    // Playback pages have no button: reloading would stop the video.
    await page.goto(base + '/movies/radarr-1/play');
    await page.waitForSelector('main, .app');
    expect(await page.locator('.refresh-button').count()).toBe(0);
    expect(errors).toEqual([]);
  });
});
