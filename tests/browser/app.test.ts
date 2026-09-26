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
    expect(await page.locator('.user-menu-button').getAttribute('title')).toMatch(/owner/);
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

describe('concerts and videos', () => {
  const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

  it('shows Concerts and Videos on the artist page and opens the player', async () => {
    await page.route('**/api/artists/lidarr-9', r => r.fulfill(json({ id: 'lidarr-9', title: 'Scorpions', type: 'artist', status: 'missing', genres: ['Rock'] })));
    await page.route('**/api/artists/lidarr-9/albums', r => r.fulfill(json({ artistId: 'lidarr-9', albums: [] })));
    await page.route('**/api/artists/lidarr-9/covers', r => r.fulfill(json({ candidates: [], chosen: null })));
    await page.route('**/api/artists/lidarr-9/videos', r => r.fulfill(json({
      concerts: [{ id: 'musicvideo-9~Q29uY2VydHMvYS5ta3Y', title: 'Live in Berlin', kind: 'Concerts', sizeBytes: 3_800_000_000, folder: '' }],
      videos: [{ id: 'musicvideo-9~VmlkZW9zL2IubXA0', title: 'Wind of Change', kind: 'Videos', sizeBytes: 90_000_000, folder: '' }]
    })));
    await page.goto(base + '/music/lidarr-9');
    await page.waitForSelector('.mv-card');
    expect(await page.locator('section[aria-label="Concerts"] .mv-card-title').innerText()).toBe('Live in Berlin');
    expect(await page.locator('section[aria-label="Videos"] .mv-card-title').innerText()).toBe('Wind of Change');
    expect(await page.locator('section[aria-label="Concerts"] .mv-card-sub').innerText()).toBe('3.8 GB');

    await page.route('**/api/stream/musicvideo-9~Q29uY2VydHMvYS5ta3Y/info', r => r.fulfill(json({ playable: true, transcodingAvailable: false, durationSeconds: 100 })));
    await page.route('**/api/progress/**', r => r.fulfill(json({ percent: 0, positionSeconds: 0 })));
    await page.locator('section[aria-label="Concerts"] .mv-card').click();
    await page.waitForURL(/\/music\/lidarr-9\/watch\//);
    await page.waitForSelector('.player-title');
    expect(await page.locator('.player-title').innerText()).toBe('Live in Berlin');
  });

  it('asks an administrator which artist a download belongs to', async () => {
    let filed: unknown = null;
    let pending = [{ hash: 'c'.repeat(40), name: 'Rock Concert 2019 1080p', status: 'needs_artist', kind: 'Concerts', artistId: null, artistName: null, message: 'x', updatedAt: '' }];
    await page.route('**/api/music-videos/pending', r => r.fulfill(json({ jobs: pending })));
    await page.route('**/api/music-videos/file', async r => { filed = r.request().postDataJSON(); pending = []; await r.fulfill(json({ ok: true, message: 'Filed under Kiss / Concerts (new artist added to the library).', artistId: 4 })); });
    await page.goto(base + '/music');
    await page.waitForSelector('.mv-pending-row');
    await page.locator('.mv-pending-row input').fill('Kiss');
    await page.locator('.mv-pending-row button').click();
    await page.waitForSelector('.mv-pending-note');
    expect(filed).toMatchObject({ hash: 'c'.repeat(40), artist: 'Kiss', kind: 'Concerts' });
    expect(await page.locator('.mv-pending-note').innerText()).toMatch(/Filed under Kiss/);
    expect(errors).toEqual([]);
  });
});

describe('pick a release by hand', () => {
  it('searches with your own words from a request that found nothing, and starts the one you choose', async () => {
    const now = new Date().toISOString();
    await page.route(/\/api\/requests(\?.*)?$/, r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [{
      id: 'request-9', title: 'Linkin Park - Live at Rock am Ring', year: 2004, status: 'searching', service: 'radarr', mediaType: 'movie',
      message: 'Nothing found yet', createdAt: now, updatedAt: now
    }], total: 1 }) }));
    let searched = '';
    let grabbed: unknown = null;
    await page.route('**/api/releases/search**', r => { searched = new URL(r.request().url()).searchParams.get('q') ?? ''; return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ query: searched, releases: [
      { id: 'magnet:?xt=urn:btih:2', title: 'Linkin Park - Rock Am Ring 2004', cleanTitle: 'Linkin Park - Rock Am Ring 2004', indexer: 'The Pirate Bay', sizeBytes: 976_000_000, seeders: 9, ageDays: 400, quality: '', filesUnder: 'Concerts' }
    ] }) }); });
    await page.route('**/api/releases/grab', r => { grabbed = r.request().postDataJSON(); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, message: "Downloading. It will be filed under the artist's Concerts when it finishes.", filesUnder: 'Concerts' }) }); });
    await page.goto(base + '/requests');
    await page.getByRole('button', { name: 'More for Linkin Park - Live at Rock am Ring' }).click();
    await page.getByRole('menuitem', { name: /Pick a release by hand/ }).click();
    await page.getByRole('button', { name: 'Find a release myself' }).click();
    await page.getByLabel('Search words').fill('Linkin Park Rock am Ring 2004');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.waitForSelector('.release-row');
    expect(searched).toBe('Linkin Park Rock am Ring 2004');
    expect(await page.locator('.release-row-meta').innerText()).toMatch(/9 seeders.*files under artist \/ Concerts/);
    await page.locator('.release-row').getByRole('button', { name: 'Download' }).click();
    await page.waitForSelector('.release-picker-note');
    expect(grabbed).toEqual({ id: 'magnet:?xt=urn:btih:2', fileAs: 'auto' });
    expect(await page.locator('.release-picker-note').innerText()).toMatch(/filed under the artist/);
    expect(errors).toEqual([]);
  });
});

describe('upgrade music quality', () => {
  it('tells the person it takes time, then moves the artist to Best available and searches', async () => {
    const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    await page.route('**/api/artists/lidarr-3', r => r.fulfill(json({ id: 'lidarr-3', title: 'Queen', type: 'artist', status: 'available', trackFileCount: 12, totalTrackCount: 12, albumCount: 1 })));
    await page.route('**/api/artists/lidarr-3/albums', r => r.fulfill(json({ artistId: 'lidarr-3', albums: [] })));
    await page.route('**/api/artists/lidarr-3/covers', r => r.fulfill(json({ candidates: [], chosen: null })));
    await page.route('**/api/artists/lidarr-3/videos', r => r.fulfill(json({ concerts: [], videos: [] })));
    await page.route('**/api/quality/artist/lidarr-3', async r => {
      if (r.request().method() === 'GET') return r.fulfill(json({ profiles: [{ id: 1, name: 'Any' }, { id: 3, name: 'Standard' }, { id: 4, name: 'Best available' }], current: 3 }));
      posted = r.request().postDataJSON();
      return r.fulfill(json({ success: true, message: 'Quality updated. Searching for a release in that quality.' }));
    });
    let posted: unknown = null;
    await page.goto(base + '/music/lidarr-3');
    await page.getByRole('button', { name: 'More for this artist' }).click();
    await page.getByRole('menuitem', { name: 'Upgrade quality' }).click();
    expect(await page.locator('.upgrade-quality-confirm').innerText()).toMatch(/can take some time/i);
    await page.getByRole('button', { name: 'Start upgrade' }).click();
    await page.waitForSelector('.upgrade-quality .notice--ok');
    expect(posted).toEqual({ profileId: 4, search: true });
    expect(await page.locator('.upgrade-quality .notice--ok').innerText()).toMatch(/take a while/i);
    expect(errors).toEqual([]);
  });
});

describe('music player', () => {
  const shots = process.env.VV_SHOTS;
  const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

  /** 40 seconds of quiet audio: small, and it lets the browser really play and seek. */
  const wav = (() => {
    const rate = 8000, seconds = 40, data = Buffer.alloc(rate * seconds, 128);
    const h = Buffer.alloc(44);
    h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
    h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate, 28); h.writeUInt16LE(1, 32); h.writeUInt16LE(8, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
    return Buffer.concat([h, data]);
  })();
  const cover = '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="500"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#c0392b"/><stop offset="1" stop-color="#2c3e50"/></linearGradient></defs><rect width="500" height="500" fill="url(#g)"/><circle cx="250" cy="250" r="120" fill="#e67e22" opacity=".8"/></svg>';

  it('plays, shows a smooth progress bar you can drag, and opens a full Now Playing view with queue and controls', async () => {
    await page.route('**/api/albums/album-7', r => r.fulfill(json({
      album: { id: 7, title: 'Meteora', artistTitle: 'Linkin Park', artwork: { cover: '/test-cover.svg' }, releaseDate: '2003-03-25' },
      tracks: [1, 2, 3].map(n => ({ id: n, title: ['Foreword', 'Don\'t Stay', 'Somewhere I Belong'][n - 1], albumId: 7, trackNumber: String(n), durationMs: 40_000, hasFile: true, quality: 'FLAC' }))
    })));
    await page.route('**/test-cover.svg', r => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: cover }));
    await page.route('**/api/music/stream/*', async r => {
      const range = /bytes=(\d+)-(\d*)/.exec(r.request().headers()['range'] ?? '');
      if (!range) return r.fulfill({ status: 200, headers: { 'Content-Type': 'audio/wav', 'Accept-Ranges': 'bytes' }, body: wav });
      const start = Number(range[1]), end = range[2] ? Number(range[2]) : wav.length - 1;
      return r.fulfill({ status: 206, headers: { 'Content-Type': 'audio/wav', 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${wav.length}` }, body: wav.subarray(start, end + 1) });
    });
    await page.route('**/api/lyrics**', r => r.fulfill({ status: 404, contentType: 'application/json', body: '{}' }));

    await page.goto(base + '/albums/album-7');
    await page.locator('.album-track-row').first().waitFor();
    await page.getByRole('button', { name: /play album|play all|play/i }).first().click();
    await page.waitForSelector('.mp .mp-play');
    if (shots) await page.screenshot({ path: `${shots}/player-mini.png` });

    // The bar moves on its own, without waiting for a page update.
    const now = () => page.locator('.mp-center .seek-track').getAttribute('aria-valuenow').then(Number);
    await page.waitForFunction(() => Number(document.querySelector('.mp-center .seek-track')?.getAttribute('aria-valuenow')) >= 1, null, { timeout: 15_000 });
    expect(await now()).toBeGreaterThanOrEqual(1);
    const p1 = await page.locator('.mp-center .seek').evaluate(el => Number(getComputedStyle(el).getPropertyValue('--p')));
    expect(p1).toBeGreaterThan(0);

    // Clicking the bar seeks; the readout follows.
    const box = (await page.locator('.mp-center .seek-track').boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.75, box.y + box.height / 2);
    await page.waitForFunction(() => Number(document.querySelector('.mp-center .seek-track')?.getAttribute('aria-valuenow')) >= 28);
    expect(await page.locator('.mp-center .seek-track').getAttribute('aria-valuetext')).toMatch(/^0:\d\d of 0:40$/);

    await page.mouse.move(box.x + box.width * 0.4, box.y + box.height / 2);
    await page.waitForTimeout(250);
    if (shots) await page.screenshot({ path: `${shots}/player-mini-hover.png`, clip: { x: 300, y: 700, width: 700, height: 100 } });

    // Keyboard: arrows nudge by five seconds.
    await page.locator('.mp-center .seek-track').focus();
    const before = await now();
    await page.keyboard.press('ArrowLeft');
    await page.waitForFunction(b => Number(document.querySelector('.mp-center .seek-track')?.getAttribute('aria-valuenow')) < b, before);

    // Pause and play.
    await page.getByRole('button', { name: 'Pause' }).first().click();
    await page.getByRole('button', { name: 'Play', exact: true }).first().waitFor();
    await page.getByRole('button', { name: 'Play', exact: true }).first().click();

    // Open the full view.
    await page.locator('.mp-now').click();
    await page.waitForSelector('.np.is-open');
    await page.waitForTimeout(450);
    expect(await page.locator('.np-title').innerText()).toBe('Foreword');
    expect(await page.locator('.mp-queue-row').count()).toBe(3);
    if (shots) await page.screenshot({ path: `${shots}/player-now-playing.png` });

    // Repeat cycles through its three states; shuffle toggles.
    const repeat = page.locator('.np .mp-transport .mp-icon').last();
    expect(await repeat.getAttribute('aria-label')).toBe('Repeat: off');
    await repeat.click(); expect(await repeat.getAttribute('aria-label')).toBe('Repeat: all tracks');
    await repeat.click(); expect(await repeat.getAttribute('aria-label')).toBe('Repeat: this track');
    await repeat.click(); expect(await repeat.getAttribute('aria-label')).toBe('Repeat: off');

    // Jump to the third track from the queue, then take one out.
    await page.locator('.mp-queue-row').nth(2).locator('.mp-queue-main').click();
    await page.waitForFunction(() => document.querySelector('.np-title')?.textContent === 'Somewhere I Belong');
    await page.locator('.mp-queue-row').nth(1).hover();
    await page.getByRole('button', { name: /Remove Don't Stay/ }).click();
    expect(await page.locator('.mp-queue-row').count()).toBe(2);

    // The other tabs.
    await page.getByRole('tab', { name: 'Equalizer' }).click();
    await page.waitForSelector('.mp-eq');
    await page.getByRole('tab', { name: 'Lyrics' }).click();
    await page.getByText('No lyrics found for this track.').waitFor();
    if (shots) await page.screenshot({ path: `${shots}/player-lyrics.png` });

    // Escape closes it and playback carries on.
    await page.keyboard.press('Escape');
    await page.waitForSelector('.np:not(.is-open)');
    expect(await page.locator('.mp-play').first().getAttribute('aria-label')).toBe('Pause');

    // A phone: the bar shrinks to what matters and the view stacks.
    await page.setViewportSize({ width: 390, height: 780 });
    await page.waitForTimeout(200);
    if (shots) await page.screenshot({ path: `${shots}/player-mini-phone.png` });
    await page.locator('.mp-now').click();
    await page.waitForSelector('.np.is-open');
    await page.waitForTimeout(450);
    if (shots) await page.screenshot({ path: `${shots}/player-now-playing-phone.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.setViewportSize({ width: 1280, height: 800 });
    expect(errors).toEqual([]);
  }, 90_000);
});

describe('concerts from YouTube', () => {
  const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  const result = { id: '9PSo4PjbDbs', title: 'Linkin Park - Rock am Ring 2004 (Full Show)', channel: 'Phoenix LPLive220', durationSeconds: 4262, views: 1_921_185, thumbnail: '/thumb.jpg', artistGuess: 'Linkin Park', kind: 'Concerts' };

  it('finds a concert on YouTube from the artist page and shows the download until it is done', async () => {
    await page.route('**/thumb.jpg', r => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="9"/>' }));
    await page.route('**/api/artists/lidarr-4', r => r.fulfill(json({ id: 'lidarr-4', title: 'Linkin Park', type: 'artist', status: 'available', trackFileCount: 5, totalTrackCount: 5, albumCount: 1 })));
    await page.route('**/api/artists/lidarr-4/albums', r => r.fulfill(json({ artistId: 'lidarr-4', albums: [] })));
    await page.route('**/api/artists/lidarr-4/covers', r => r.fulfill(json({ candidates: [], chosen: null })));
    let videosCalls = 0;
    await page.route('**/api/artists/lidarr-4/videos', r => { videosCalls++; return r.fulfill(json({ concerts: [], videos: [] })); });
    await page.route('**/api/youtube/status', r => r.fulfill(json({ available: true })));
    let searched = '';
    await page.route('**/api/youtube/search**', r => { searched = new URL(r.request().url()).searchParams.get('q') ?? ''; return r.fulfill(json({ query: searched, results: [result] })); });
    let posted: unknown = null;
    await page.route('**/api/youtube/download', r => { posted = r.request().postDataJSON(); return r.fulfill(json({ ok: true, message: 'Downloading. It will appear under Linkin Park / Concerts.', artistId: 4, artistName: 'Linkin Park', kind: 'Concerts' })); });
    let phase = 0;
    await page.route('**/api/youtube/jobs', r => {
      const status = phase === 0 ? 'queued' : phase === 1 ? 'downloading' : 'done';
      return r.fulfill(json({ jobs: phase === 0 && !posted ? [] : [{ id: 'j1', videoId: result.id, title: result.title, dir: '/media/music/Linkin Park/Concerts', status, percent: status === 'done' ? 100 : 40, speed: '1.2MiB/s', eta: '00:30' }] }));
    });

    await page.goto(base + '/music/lidarr-4');
    await page.getByRole('button', { name: 'More for this artist' }).click();
    await page.getByRole('menuitem', { name: 'Find concerts on YouTube' }).click();
    await page.getByLabel('Search YouTube').waitFor();
    expect(await page.getByLabel('Search YouTube').inputValue()).toBe('Linkin Park live concert');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.waitForSelector('.yt-row');
    expect(searched).toBe('Linkin Park live concert');
    expect(await page.locator('.yt-row .release-row-meta').innerText()).toMatch(/1:11:02.*1\.9M views.*concert/);

    await page.locator('.yt-row').getByRole('button', { name: 'Save' }).click();
    await page.waitForSelector('.yt-job');
    expect(posted).toEqual({ id: '9PSo4PjbDbs', title: result.title, artist: 'Linkin Park', kind: 'Concerts' });
    const before = videosCalls;
    phase = 1;
    await page.waitForFunction(() => /40%/.test(document.querySelector('.yt-job-state')?.textContent ?? ''), null, { timeout: 8000 });
    phase = 2;
    // When it finishes the artist's Concerts list is loaded again.
    await page.waitForFunction(() => /Done/.test(document.querySelector('.yt-job-state')?.textContent ?? ''), null, { timeout: 8000 });
    await page.waitForTimeout(300);
    expect(videosCalls).toBeGreaterThan(before);
    expect(errors).toEqual([]);
  });

  it('says how to turn it on when the YouTube service is off', async () => {
    await page.unroute('**/api/youtube/status');
    await page.route('**/api/youtube/status', r => r.fulfill(json({ available: false })));
    await page.goto(base + '/music/lidarr-4');
    await page.getByRole('button', { name: 'More for this artist' }).click();
    await page.getByRole('menuitem', { name: 'Find concerts on YouTube' }).click();
    await page.getByText('docker compose --profile youtube up -d').waitFor();
    expect(errors).toEqual([]);
  });
});

describe('search, requests and downloads agree', () => {
  const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

  it('search marks what is already requested and links to the request instead of offering it again', async () => {
    await page.route('**/api/search/all**', r => r.fulfill(json({
      query: 'dune', library: [], series: [], artists: [], tracks: [],
      movies: [
        { provider: 'tmdb', providerId: '1', title: 'Dune', year: 2021, type: 'movie', requestId: 'request-1', requestStatus: 'downloading' },
        { provider: 'tmdb', providerId: '2', title: 'Dune', year: 1984, type: 'movie' }
      ]
    })));
    await page.goto(base + '/search?q=dune');
    await page.waitForSelector('.result-card');
    const cards = page.locator('.result-card');
    expect(await cards.nth(0).getByRole('link', { name: 'Requested · downloading' }).count()).toBe(1);
    expect(await cards.nth(0).getByRole('button', { name: 'Request', exact: true }).count()).toBe(0);
    expect(await cards.nth(1).getByRole('button', { name: 'Request', exact: true }).count()).toBe(1);
    expect(errors).toEqual([]);
  });

  it('a stalled download is called stalled and offers another release', async () => {
    await page.route(/\/api\/downloads(\?.*)?$/, r => r.fulfill(json([
      { id: 'queue-radarr-1', title: 'I Am Legend 2007 Theatrical', progress: 0, status: 'stalled', message: 'The download is stalled with no connections', sourceClient: 'qbittorrent', reportedBy: ['qbittorrent', 'radarr'], mediaType: 'movie', mediaId: 'radarr-1', actions: ['pause', 'remove'] },
      { id: 'queue-qbittorrent-2', title: 'How I Met Your Mother S07', progress: 100, status: 'completed', sourceClient: 'qbittorrent', mediaType: 'series', mediaId: 'sonarr-1', actions: ['remove'] }
    ])));
    await page.goto(base + '/downloads');
    await page.getByText('I Am Legend 2007 Theatrical').waitFor();
    expect(await page.getByRole('button', { name: 'Try another release' }).count()).toBe(1);
    expect(await page.locator('.rq-line').first().innerText()).toMatch(/stalled/);
    // A finished season pack links to its series.
    await page.getByRole('radio', { name: /Completed/ }).click();
    expect(await page.getByRole('link', { name: 'Open' }).getAttribute('href')).toBe('/series/sonarr-1');
    expect(errors).toEqual([]);
  });
});

describe('artist page and music page layout', () => {
  const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  const artist = { id: 'lidarr-6', title: 'Linkin Park', type: 'artist', status: 'available', trackFileCount: 39, totalTrackCount: 107, albumCount: 5, genres: ['Rock', 'Nu Metal'], overview: 'Linkin Park is an American rock band from Agoura Hills, California. Formed in 1996, the band rose to international fame with their debut album Hybrid Theory, released in 2000. '.repeat(3) };

  it('keeps the page calm: Play and My List up front, the rest in a menu, members below', async () => {
    await page.route('**/api/artists/lidarr-6', r => r.fulfill(json(artist)));
    await page.route('**/api/artists/lidarr-6/albums', r => r.fulfill(json({ artistId: 'lidarr-6', albums: [] })));
    await page.route('**/api/artists/lidarr-6/videos', r => r.fulfill(json({ concerts: [], videos: [] })));
    await page.route('**/api/artists/lidarr-6/members', r => r.fulfill(json({ kind: 'band', members: [
      { name: 'Mike Shinoda', role: 'guitar', years: '1996–present', current: true, photo: '' },
      { name: 'Chester Bennington', role: 'lead vocals', years: '1996–2017', current: false, photo: '' }
    ] })));
    let coversCalls = 0;
    await page.route('**/api/artists/lidarr-6/covers', r => { coversCalls++; return r.fulfill(json({ candidates: [{ url: 'https://x/logo.png', preview: '/l.svg', source: 'lidarr', label: 'Logo', kind: 'logo' }], chosen: null })); });
    await page.route('**/api/artists/lidarr-6/covers/more', r => r.fulfill(json({ artistId: 'lidarr-6', added: 2, chosen: null, candidates: [
      { url: 'https://x/logo.png', preview: '/l.svg', source: 'lidarr', label: 'Logo', kind: 'logo' },
      { url: 'https://x/p.jpg', preview: '/p.svg', source: 'deezer', label: 'Deezer photo', kind: 'artist' },
      { url: 'https://x/g.jpg', preview: '/g.svg', source: 'wikimedia', label: 'Group photo', kind: 'group' },
      { url: 'https://x/album.jpg', preview: '/a.svg', source: 'itunes', label: 'An album', kind: 'album' }
    ] })));
    for (const f of ['l', 'p', 'g', 'a']) await page.route(`**/${f}.svg`, r => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>' }));

    await page.goto(base + '/music/lidarr-6');
    await page.getByRole('heading', { name: 'Linkin Park', level: 1 }).waitFor();
    // Up front: the two things people come to do, plus the menu. Not a row of seven buttons.
    expect(await page.locator('.ah-actions > .btn, .ah-actions .more-trigger').count()).toBeLessThanOrEqual(3);
    expect(await page.getByRole('button', { name: /Play mix/ }).count()).toBe(1);
    expect(await page.getByRole('button', { name: 'Upgrade quality' }).count()).toBe(0);
    expect(await page.locator('.title-quality').count()).toBe(0);
    // The long biography is folded until asked for.
    expect(await page.locator('.ah-bio p.is-clamped').count()).toBe(1);
    await page.getByRole('button', { name: 'Read more' }).click();
    expect(await page.locator('.ah-bio p.is-clamped').count()).toBe(0);
    if (process.env.VV_SHOTS) await page.screenshot({ path: `${process.env.VV_SHOTS}/artist-desktop.png`, fullPage: true });
    // Band members: current first, former under their own heading.
    await page.getByRole('heading', { name: 'Band members' }).waitFor();
    expect(await page.locator('.people-section .person-name').allInnerTexts()).toEqual(['Mike Shinoda', 'Chester Bennington']);
    expect(await page.getByRole('heading', { name: 'Former members' }).count()).toBe(1);

    // The menu, keyboard-reachable, then artwork in its own dialog without album covers.
    await page.getByRole('button', { name: 'More for this artist' }).click();
    expect(await page.getByRole('menuitem').count()).toBeGreaterThanOrEqual(4);
    await page.getByRole('menuitem', { name: /Change artwork/ }).click();
    await page.getByRole('dialog', { name: 'Artwork' }).waitFor();
    await page.getByRole('button', { name: 'Use Group photo' }).waitFor();
    if (process.env.VV_SHOTS) await page.screenshot({ path: `${process.env.VV_SHOTS}/artist-artwork.png` });
    expect(await page.getByRole('heading', { name: 'Logos' }).count()).toBe(1);
    expect(await page.getByRole('heading', { name: 'Band and group photos' }).count()).toBe(1);
    expect(await page.getByText('An album', { exact: true }).count()).toBe(0);
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    await page.setViewportSize({ width: 390, height: 800 });
    await page.waitForTimeout(200);
    if (process.env.VV_SHOTS) await page.screenshot({ path: `${process.env.VV_SHOTS}/artist-phone.png`, fullPage: true });
    await page.setViewportSize({ width: 1280, height: 800 });
    expect(errors).toEqual([]);
  });

  it('the music page opens with a clear header, a playlist row and Add artist in a dialog', async () => {
    await page.route('**/api/artists', r => r.request().method() === 'GET' ? r.fulfill(json([artist])) : r.continue());
    await page.route('**/api/playlists', r => r.request().method() === 'GET' ? r.fulfill(json([{ id: 'p1', name: 'Road trip', tracks: [{ trackId: '1', title: 'x' }], createdAt: '', updatedAt: '' }])) : r.continue());
    await page.goto(base + '/music');
    await page.getByRole('heading', { name: 'Music', level: 1 }).waitFor();
    await page.getByRole('link', { name: /Road trip/ }).waitFor();
    if (process.env.VV_SHOTS) await page.screenshot({ path: `${process.env.VV_SHOTS}/music-page.png` });
    // No big form up top any more.
    expect(await page.getByLabel('Artist name').count()).toBe(0);
    await page.getByRole('button', { name: 'Add artist' }).click();
    await page.getByRole('dialog', { name: 'Add an artist' }).waitFor();
    if (process.env.VV_SHOTS) await page.screenshot({ path: `${process.env.VV_SHOTS}/add-artist.png` });
    await page.getByLabel('Artist name').fill('Queen');
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    // A new playlist opens inline.
    await page.getByRole('button', { name: 'New playlist' }).click();
    await page.getByLabel('New playlist name').waitFor();
    expect(errors).toEqual([]);
  });
});

describe('phones, band members and troubleshooting', () => {
  const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

  it('shows a bottom tab bar on a phone with the rest under More, and none on a desktop', async () => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(base + '/movies');
    await page.getByRole('heading', { name: 'Movies', level: 1 }).waitFor();
    expect(await page.locator('nav.tabs').isVisible()).toBe(false);

    await page.setViewportSize({ width: 390, height: 800 });
    await page.waitForTimeout(150);
    const bar = page.getByRole('navigation', { name: 'Main' });
    await bar.waitFor();
    expect(await bar.getByRole('link').allInnerTexts()).toEqual(['Home', 'Movies', 'TV', 'Music']);
    await bar.getByRole('button', { name: 'More' }).click();
    const sheet = page.getByRole('dialog', { name: 'More' });
    await sheet.waitFor();
    await sheet.getByRole('link', { name: 'Downloads' }).click();
    await page.getByRole('heading', { name: 'Downloads', level: 1 }).waitFor();
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    // Nothing on the page is wider than the phone.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.setViewportSize({ width: 1280, height: 800 });
    expect(errors).toEqual([]);
  });

  it('lets people show only current or former members, and edit the list', async () => {
    await page.route('**/api/artists/lidarr-7', r => r.fulfill(json({ id: 'lidarr-7', title: 'Pink Floyd', type: 'artist', status: 'available', trackFileCount: 1, totalTrackCount: 1, albumCount: 1, genres: [], overview: '' })));
    await page.route('**/api/artists/lidarr-7/albums', r => r.fulfill(json({ artistId: 'lidarr-7', albums: [] })));
    await page.route('**/api/artists/lidarr-7/videos', r => r.fulfill(json({ concerts: [], videos: [] })));
    await page.route('**/api/artists/lidarr-7/members', r => r.fulfill(json({ kind: 'band', removed: [], members: [
      { name: 'David Gilmour', role: 'guitar', years: '1968–2015', current: true, photo: '' },
      { name: 'Syd Barrett', role: 'vocals', years: '1965–1968', current: false, photo: '' }
    ] })));
    await page.goto(base + '/music/lidarr-7');
    await page.getByRole('heading', { name: 'Band members' }).waitFor();
    const names = () => page.locator('.people-section .person-name').allInnerTexts();
    expect(await names()).toEqual(['David Gilmour', 'Syd Barrett']);
    await page.getByRole('radio', { name: /Former/ }).click();
    expect(await names()).toEqual(['Syd Barrett']);
    await page.getByRole('radio', { name: /Current/ }).click();
    expect(await names()).toEqual(['David Gilmour']);
    // Remembered after a reload.
    await page.reload();
    await page.getByRole('heading', { name: 'Band members' }).waitFor();
    expect(await names()).toEqual(['David Gilmour']);
    await page.getByRole('radio', { name: /Everyone/ }).click();
    await page.getByRole('button', { name: /Edit/ }).click();
    await page.getByLabel('New member name').waitFor();
    expect(errors).toEqual([]);
  });

  it('troubleshooting on the Apps page names the problem, what to try, and a restart', async () => {
    let restarted = '';
    await page.route('**/api/troubleshoot', r => r.fulfill(json({ checkedAt: new Date().toISOString(), checks: [
      { id: 'flare', area: 'Search', label: 'Cloudflare helper for search sources', status: 'fail', detail: 'The Cloudflare helper is not running.', fixes: ['Start it from the Apps page.'], restart: 'flaresolverr' },
      { id: 'net', area: 'Internet', label: 'Internet', status: 'ok', detail: 'Reachable.', fixes: [] }
    ] })));
    await page.route('**/api/troubleshoot/restart', r => { restarted = r.request().postData() ?? ''; return r.fulfill(json({ message: 'Restarted.' })); });
    await page.goto(base + '/apps');
    await page.getByRole('heading', { name: 'Troubleshooting' }).waitFor();
    await page.getByText('1 thing needs attention.').waitFor();
    await page.getByText('Start it from the Apps page.').waitFor();
    await page.getByRole('button', { name: 'Restart flaresolverr' }).click();
    await page.getByText('Restarted.').waitFor();
    expect(restarted).toContain('flaresolverr');
    await page.getByRole('button', { name: /Show what is fine/ }).click();
    await page.getByText('Reachable.').waitFor();
    expect(errors).toEqual([]);
  });
});

describe('settings, photos, live tv and requests', () => {
  const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect width="40" height="30" fill="#446"/></svg>';

  it('settings opens on a guided overview, finds a setting by search, and keeps old links working', async () => {
    await page.goto(base + '/settings');
    await page.getByRole('heading', { name: 'What do you want to do?' }).waitFor();
    expect(await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button').count()).toBeGreaterThanOrEqual(10);
    await page.getByLabel('Find a setting').fill('backup');
    await page.getByRole('region', { name: 'Search results' }).getByRole('button', { name: /Back up or restore/ }).click();
    await page.getByRole('heading', { name: 'Backup and restore', level: 2 }).waitFor();
    // Links from before the makeover still land in the right place.
    await page.goto(base + '/settings?cat=users');
    await page.getByRole('heading', { name: 'People and requests', level: 2 }).waitFor();
    expect(errors).toEqual([]);
  });

  it('photos: timeline, viewer with favorite and keys, and adding to a new album', async () => {
    const items = ['a.jpg', 'Trip/b.jpg', 'Trip/c.jpg'].map((path, i) => ({ path, name: path.split('/').pop(), size: 2_000_000, modified: Date.UTC(2026, 8, 20 - i) }));
    const favPosts: unknown[] = [];
    const albumPosts: unknown[] = [];
    await page.route('**/api/photos/all', r => r.fulfill(json({ items, truncated: false })));
    await page.route('**/api/photos/favorites', r => r.fulfill(json({ paths: [] })));
    await page.route('**/api/photos/favorite', r => { favPosts.push(r.request().postDataJSON()); return r.fulfill(json({ ok: true })); });
    await page.route('**/api/photos/thumb**', r => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: svg }));
    await page.route('**/api/photos/file**', r => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: svg }));
    await page.route('**/api/photo-albums', r => { if (r.request().method() === 'POST') { albumPosts.push(r.request().postDataJSON()); return r.fulfill(json({ id: 'al1', name: 'Trip', count: 2, cover: 'a.jpg', updatedAt: '' })); } return r.fulfill(json({ albums: [] })); });
    await page.goto(base + '/photos');
    await page.getByRole('heading', { name: 'September 2026' }).waitFor();
    expect(await page.locator('.ph-tile').count()).toBe(3);

    await page.getByRole('button', { name: 'Open a.jpg' }).click();
    const viewer = page.getByRole('dialog', { name: 'Photo viewer' });
    await viewer.getByText('1 of 3').waitFor();
    await page.keyboard.press('ArrowRight');
    await viewer.getByText('2 of 3').waitFor();
    await page.keyboard.press('f');
    await page.waitForTimeout(150);
    expect(favPosts).toEqual([{ path: 'Trip/b.jpg', favorite: true }]);
    expect(await viewer.getByRole('link', { name: 'Download the original' }).getAttribute('href')).toContain('download=1');
    await page.keyboard.press('Escape');
    await viewer.waitFor({ state: 'detached' });

    await page.getByRole('button', { name: 'Select', exact: true }).click();
    await page.getByRole('button', { name: 'Select a.jpg' }).click();
    await page.getByRole('button', { name: 'Select Trip/b.jpg'.split('/').pop()! }).click();
    await page.getByRole('button', { name: /Add to album/ }).click();
    await page.getByLabel('New album name').fill('Trip');
    await page.getByRole('button', { name: 'Create and add' }).click();
    await page.getByText('Added 2 photos to "Trip".').waitFor();
    expect(albumPosts).toEqual([{ name: 'Trip', paths: ['a.jpg', 'Trip/b.jpg'] }]);
    expect(errors).toEqual([]);
  });

  it('live tv: favorites first, a guide grid, and a heart that remembers', async () => {
    const now = Date.now();
    const channels = [
      { id: '000000000001', name: 'News One', group: 'News', playlist: 'p', guide: true },
      { id: '000000000002', name: 'Sport Two', group: 'Sports', playlist: 'p', guide: true },
      { id: '000000000003', name: 'Kids Three', group: 'Kids', playlist: 'p' }
    ];
    const hearts: unknown[] = [];
    await page.route('**/api/live/playlists', r => r.request().method() === 'GET' ? r.fulfill(json({ playlists: [{ id: 'p', name: 'Test', url: 'http://x/list.m3u' }] })) : r.continue());
    await page.route('**/api/live/channels', r => r.fulfill(json({ channels, problems: [] })));
    await page.route('**/api/live/me', r => r.fulfill(json({ favorites: ['000000000002'], recent: [], dead: ['000000000003'] })));
    await page.route('**/api/live/recordings', r => r.fulfill(json({ recordings: [] })));
    await page.route('**/api/live/guide**', r => r.fulfill(json({ ready: true, now, programmes: {
      '000000000001': [{ start: now - 600_000, stop: now + 1_800_000, title: 'Evening Bulletin' }, { start: now + 1_800_000, stop: now + 5_400_000, title: 'Panel Show' }],
      '000000000002': [{ start: now - 600_000, stop: now + 3_000_000, title: 'League Match' }]
    } })));
    await page.route('**/api/live/favorite', r => { hearts.push(r.request().postDataJSON()); return r.fulfill(json({ ok: true })); });
    await page.route('**/api/live/stream/**', r => r.fulfill({ status: 404, contentType: 'application/json', body: '{"message":"offline in a test"}' }));
    await page.goto(base + '/live');
    // Favorites are the first view when there are any.
    await page.getByRole('button', { name: 'Watch Sport Two' }).waitFor();
    expect(await page.locator('.lv-row').count()).toBe(1);
    await page.getByRole('radio', { name: /All channels/ }).click();
    // The offline channel is hidden until asked for.
    await page.getByRole('button', { name: 'Watch News One' }).waitFor();
    expect(await page.locator('.lv-row').count()).toBe(2);
    await page.getByText('Evening Bulletin').waitFor();
    await page.getByRole('button', { name: 'Favorite News One' }).click();
    await page.waitForTimeout(120);
    expect(hearts).toEqual([{ channelId: '000000000001', favorite: true }]);
    await page.getByRole('radio', { name: 'Guide' }).click();
    await page.getByRole('table', { name: 'Program guide' }).waitFor();
    expect(await page.locator('.gg-prog').count()).toBeGreaterThanOrEqual(3);
    await page.getByRole('button', { name: /Evening Bulletin/ }).click();
    await page.getByRole('region', { name: 'Playing News One' }).waitFor();
    expect(errors).toEqual([]);
  });

  it('requests: one card per request with its step, what needs attention, and the right action', async () => {
    const now = new Date().toISOString();
    await page.route(/\/api\/requests(\?.*)?$/, r => r.fulfill(json({ items: [
      { id: 'r1', title: 'Dune: Part Two', year: 2024, status: 'downloading', service: 'radarr', mediaType: 'movie', progress: 40, download: { count: 1, progress: 40, status: 'downloading', speed: '4 MB/s', eta: '10m' }, createdAt: now, updatedAt: now },
      { id: 'r2', title: 'Chandni', year: 1989, status: 'failed', message: 'No release matched.', service: 'radarr', mediaType: 'movie', createdAt: now, updatedAt: now },
      { id: 'r3', title: 'Pink Floyd', status: 'available', providerId: 'lidarr-7', service: 'lidarr', mediaType: 'artist', createdAt: now, updatedAt: now }
    ], total: 3 })));
    await page.goto(base + '/requests');
    await page.getByRole('article', { name: 'Dune: Part Two' }).waitFor();
    expect(await page.getByRole('list', { name: /Step 3 of 5: Downloading/ }).count()).toBe(1);
    await page.getByRole('radio', { name: /Needs attention/ }).click();
    expect(await page.getByRole('article').count()).toBe(1);
    expect(await page.getByRole('article', { name: 'Chandni' }).getByRole('button', { name: 'Choose match' }).count()).toBe(1);
    await page.getByRole('radio', { name: /Finished/ }).click();
    expect(await page.getByRole('article', { name: 'Pink Floyd' }).getByRole('link', { name: 'Open' }).getAttribute('href')).toBe('/music/lidarr-7');
    expect(errors).toEqual([]);
  });
});
