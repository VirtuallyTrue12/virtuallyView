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
    await page.locator('.request-card-head').first().click();
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
    await page.getByRole('button', { name: 'Upgrade quality' }).click();
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
    await page.getByRole('button', { name: 'Find concerts and videos on YouTube' }).click();
    await page.getByLabel('Search YouTube').waitFor();
    expect(await page.getByLabel('Search YouTube').inputValue()).toBe('Linkin Park live concert');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.waitForSelector('.yt-row');
    expect(searched).toBe('Linkin Park live concert');
    expect(await page.locator('.yt-row .release-row-meta').innerText()).toMatch(/1:11:02.*1\.9M views.*concert/);

    await page.locator('.yt-row').getByRole('button', { name: 'Download' }).click();
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
    await page.getByRole('button', { name: 'Find concerts and videos on YouTube' }).click();
    await page.getByText('docker compose --profile youtube up -d').waitFor();
    expect(errors).toEqual([]);
  });
});
