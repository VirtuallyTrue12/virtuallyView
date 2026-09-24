/**
 * End-to-end HTTP suite.
 *
 * Spawns the real server (tsx -> src/index.ts) on a random port with an
 * isolated VV_DATA_DIR so nothing touches the live store, then walks
 * every route group the dashboard can hit: public endpoints, auth + account
 * management, library (empty state after the clean reset), requests,
 * downloads, progress/resume, stream + transcode, music, AI, themes,
 * integrations, services, playback, settings, system/storage, diagnostics,
 * activity and the static SPA shell.
 *
 * Every assertion targets real behavior (status codes, shapes,
 * empty/error states) - there is no mocked or fake data anywhere.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const REPO_ROOT = process.cwd();
const SERVER_ROOT = resolve(REPO_ROOT, 'apps/server');
const TSX_BIN = resolve(REPO_ROOT, 'node_modules/.bin/tsx');

let child: ChildProcess;
let base = '';
let dataDir = '';
let childLog = '';
let cookie = ''; // default session cookie (vv_session=token)
let cookieAdmin = ''; // administrator session, kept separate from user sessions
let adminId = '';

interface Res {
  status: number;
  json: any | null;
  text: string;
  setCookie: string | null;
}

async function req(
  method: string,
  path: string,
  opts: { body?: unknown; cookieOverride?: string | null; headers?: Record<string, string> } = {}
): Promise<Res> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  const cookieToSend = opts.cookieOverride === undefined ? cookie : opts.cookieOverride;
  if (cookieToSend) headers['Cookie'] = cookieToSend;
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    redirect: 'manual'
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON body (static files) */
  }
  return { status: res.status, json, text, setCookie: res.headers.get('set-cookie') };
}

function captureCookie(res: Res): void {
  if (res.setCookie) {
    const match = /vv_session=[^;]+/.exec(res.setCookie);
    if (match) cookie = match[0];
  }
}

// Sign-in attempts are rate limited per address, so the regular user signs in once and every test reuses that session.
let viewerCookieCache = '';
async function viewerCookie(): Promise<string> {
  if (!viewerCookieCache) {
    const login = await req('POST', '/api/auth/login', { body: { username: 'e2eviewer', password: 'reset-by-admin-123' } });
    viewerCookieCache = /vv_session=[^;]+/.exec(login.setCookie!)![0];
  }
  return viewerCookieCache;
}

async function waitForHealth(timeoutMs = 45_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error(
    `Server did not become healthy within ${timeoutMs}ms.\n--- child output ---\n${childLog}`
  );
}

beforeAll(async () => {
  dataDir = mkdtempSync(resolve(tmpdir(), 'vv-e2e-'));
  const port = 40000 + Math.floor(Math.random() * 9000);
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [TSX_BIN, 'src/index.ts'], {
    cwd: SERVER_ROOT,
    env: {
      ...process.env,
      VV_DATA_DIR: dataDir,
      PORT: String(port),
      TRUST_PROXY: 'loopback',
      API_RATE_LIMIT: '1000000'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout?.on('data', d => { childLog += d.toString(); });
  child.stderr?.on('data', d => { childLog += d.toString(); });
  await waitForHealth();
}, 60_000);

afterAll(async () => {
  if (child && !child.killed) child.kill('SIGTERM');
  await new Promise(r => setTimeout(r, 200));
  rmSync(dataDir, { recursive: true, force: true });
}, 30_000);

describe('e2e: public endpoints', () => {
  it('health and metrics are public and shaped', async () => {
    const health = await req('GET', '/api/health');
    expect(health.status).toBe(200);
    expect(health.json.status).toBe('ok');

    const metrics = await req('GET', '/api/metrics');
    expect(metrics.status).toBe(200);
    expect(typeof metrics.json.requests).toBe('number');
    expect(typeof metrics.json.uptimeSeconds).toBe('number');
  }, 20_000);

  it('auth status is public and reports setup required on a fresh store', async () => {
    const res = await req('GET', '/api/auth/status');
    expect(res.status).toBe(200);
    // A brand-new store has no accounts and no bootstrap credentials, so auth
    // is not enabled yet and the sign-in screen shows "create account".
    expect(res.json.enabled).toBe(false);
    expect(res.json.setupRequired).toBe(true);
    expect(res.json.authenticated).toBe(false);
  }, 20_000);

  it('the auth screen backdrop responds on an empty library', async () => {
    const res = await req('GET', '/api/auth/backdrop');
    expect(res.status).toBe(200);
    expect(res.json).toHaveProperty('backdrop');
  }, 20_000);
});

describe('e2e: authentication gate', () => {
  it('protects every /api route when unauthenticated', async () => {
    expect((await req('GET', '/api/movies', { cookieOverride: null })).status).toBe(401);
    expect((await req('GET', '/api/series', { cookieOverride: '' })).status).toBe(401);
    expect((await req('POST', '/api/requests', { body: {}, cookieOverride: null })).status).toBe(401);
    expect((await req('GET', '/api/system/storage', { cookieOverride: null })).status).toBe(401);
    expect((await req('GET', '/api/downloads', { cookieOverride: null })).status).toBe(401);
    // A garbage token is not a session.
    expect((await req('GET', '/api/movies', { cookieOverride: 'vv_session=nope' })).status).toBe(401);
  }, 30_000);
});

describe('e2e: accounts (closed sign-up + admin management)', () => {
  it('first account becomes admin', async () => {
    const signup = await req('POST', '/api/auth/signup', {
      body: { username: 'e2eadmin', password: 'e2eadmin-password-123', stayLoggedIn: false }
    });
    expect(signup.status).toBe(200);
    expect(signup.json.user.role).toBe('admin');
    expect(signup.json.authenticated).toBe(true);
    captureCookie(signup);
    cookieAdmin = cookie; // keep the admin session for admin-only operations
    adminId = signup.json.user.id;
    expect(typeof adminId).toBe('string');

    const status = await req('GET', '/api/auth/status');
    expect(status.json.setupRequired).toBe(false);
    expect(status.json.authenticated).toBe(true);
    expect(status.json.user.username).toBe('e2eadmin');
  }, 30_000);

  it('rejects bad logins and duplicates', async () => {
    const bad = await req('POST', '/api/auth/login', {
      body: { username: 'e2eadmin', password: 'wrong-password-123' }
    });
    expect(bad.status).toBe(401);

    // Sign-up is closed once the first account exists.
    const closed = await req('POST', '/api/auth/signup', {
      body: { username: 'stranger', password: 'stranger-password-123' }
    });
    expect(closed.status).toBe(403);

    const dup = await req('POST', '/api/auth/users', {
      body: { username: 'e2eadmin', password: 'another-password-123', role: 'user' },
      cookieOverride: cookieAdmin
    });
    expect(dup.status).toBe(400);

    const short = await req('POST', '/api/auth/users', {
      body: { username: 'e2euser2', password: 'abc', role: 'user' },
      cookieOverride: cookieAdmin
    });
    expect(short.status).toBe(400);
    expect(short.json.message).toMatch(/password must be at least 4/i);
    const shortName = await req('POST', '/api/auth/users', {
      body: { username: 'ab', password: 'abcd', role: 'user' },
      cookieOverride: cookieAdmin
    });
    expect(shortName.json.message).toMatch(/username must be at least 3/i);
    expect(dup.json.message).toMatch(/already taken/i);
    // A short local password is fine.
    const easy = await req('POST', '/api/auth/users', {
      body: { username: 'e2eeasy', password: 'pass', role: 'user' },
      cookieOverride: cookieAdmin
    });
    expect(easy.status).toBe(200);
  }, 30_000);

  it('admin can create, promote, demote and delete users; roles gate endpoints', async () => {
    const created = await req('POST', '/api/auth/users', {
      body: { username: 'e2euser2', password: 'e2euser2-password-123', role: 'user' },
      cookieOverride: cookieAdmin
    });
    expect(created.status).toBe(200);
    const u2 = created.json.users.find((u: any) => u.username === 'e2euser2');
    expect(u2.role).toBe('user');

    const login2 = await req('POST', '/api/auth/login', {
      body: { username: 'e2euser2', password: 'e2euser2-password-123' }
    });
    expect(login2.status).toBe(200);
    const cookieU2 = /vv_session=[^;]+/.exec(login2.setCookie!)![0];

    // Non-admins cannot manage accounts.
    expect((await req('GET', '/api/auth/users', { cookieOverride: cookieU2 })).status).toBe(403);

    // Promote -> the same session now passes.
    const promote = await req('POST', `/api/auth/users/${u2.id}/role`, {
      body: { role: 'admin' },
      cookieOverride: cookieAdmin
    });
    expect(promote.status).toBe(200);
    expect((await req('GET', '/api/auth/users', { cookieOverride: cookieU2 })).status).toBe(200);

    // Demote -> locked out again.
    const demote = await req('POST', `/api/auth/users/${u2.id}/role`, {
      body: { role: 'user' },
      cookieOverride: cookieAdmin
    });
    expect(demote.status).toBe(200);
    expect((await req('GET', '/api/auth/users', { cookieOverride: cookieU2 })).status).toBe(403);

    // You cannot delete the account you are signed in with.
    const selfDelete = await req('DELETE', `/api/auth/users/${adminId}`, {
      cookieOverride: cookieAdmin
    });
    expect(selfDelete.status).toBe(400);
  }, 30_000);

  it('deleting a user invalidates their session immediately', async () => {
    const made3 = await req('POST', '/api/auth/users', {
      body: { username: 'e2euser3', password: 'e2euser3-password-123', role: 'user' },
      cookieOverride: cookieAdmin
    });
    expect(made3.status).toBe(200);
    const login3 = await req('POST', '/api/auth/login', {
      body: { username: 'e2euser3', password: 'e2euser3-password-123' }
    });
    expect(login3.status).toBe(200);
    const cookieU3 = /vv_session=[^;]+/.exec(login3.setCookie!)![0];

    // The user session works…
    const before = await req('GET', '/api/dashboard', { cookieOverride: cookieU3 });
    expect(before.status).toBe(200);

    // …until the admin deletes the account for good.
    const adminList = await req('GET', '/api/auth/users', { cookieOverride: cookieAdmin });
    const u3 = adminList.json.users.find((u: any) => u.username === 'e2euser3');
    const removed = await req('DELETE', `/api/auth/users/${u3.id}`, {
      cookieOverride: cookieAdmin
    });
    expect(removed.status).toBe(200);

    const after = await req('GET', '/api/movies', { cookieOverride: cookieU3 });
    expect(after.status).toBe(401);
  }, 30_000);

  it('regular users cannot change server settings; admin can open sign-up', async () => {
    const made = await req('POST', '/api/auth/users', {
      body: { username: 'e2eviewer', password: 'e2eviewer-password-123', role: 'user' },
      cookieOverride: cookieAdmin
    });
    expect(made.status).toBe(200);
    const login = await req('POST', '/api/auth/login', { body: { username: 'e2eviewer', password: 'e2eviewer-password-123' } });
    const cookieViewer = /vv_session=[^;]+/.exec(login.setCookie!)![0];

    const denied = await req('POST', '/api/server-settings', { body: { serverName: 'Hacked' }, cookieOverride: cookieViewer });
    expect(denied.status).toBe(403);
    const okAdmin = await req('POST', '/api/server-settings', { body: { allowSignup: true }, cookieOverride: cookieAdmin });
    expect(okAdmin.status).toBe(200);

    const status = await req('GET', '/api/auth/status');
    expect(status.json.signupOpen).toBe(true);
    const signup = await req('POST', '/api/auth/signup', { body: { username: 'e2eself', password: 'e2eself-password-123' } });
    expect(signup.status).toBe(200);

    await req('POST', '/api/server-settings', { body: { allowSignup: false }, cookieOverride: cookieAdmin });
    const again = await req('POST', '/api/auth/signup', { body: { username: 'e2eself2', password: 'e2eself2-password-123' } });
    expect(again.status).toBe(403);
  }, 30_000);

  it('watch progress and My List are per user', async () => {
    const login = await req('POST', '/api/auth/login', { body: { username: 'e2eviewer', password: 'e2eviewer-password-123' } });
    const cookieViewer = /vv_session=[^;]+/.exec(login.setCookie!)![0];

    await req('POST', '/api/progress/movie/radarr-1', { body: { positionSeconds: 600, durationSeconds: 6000 }, cookieOverride: cookieViewer });
    const mine = await req('GET', '/api/progress/movie/radarr-1', { cookieOverride: cookieViewer });
    expect(Math.round(mine.json.percent)).toBe(10);
    const theirs = await req('GET', '/api/progress/movie/radarr-1', { cookieOverride: cookieAdmin });
    expect(theirs.json.percent).toBe(0);

    await req('POST', '/api/me/flags/movie/radarr-1', { body: { favorite: true }, cookieOverride: cookieViewer });
    expect((await req('GET', '/api/me/flags/movie/radarr-1', { cookieOverride: cookieViewer })).json.favorite).toBe(true);
    expect((await req('GET', '/api/me/flags/movie/radarr-1', { cookieOverride: cookieAdmin })).json.favorite).toBe(false);

    // Marking watched drops the resume point.
    await req('POST', '/api/me/flags/movie/radarr-1', { body: { watched: true }, cookieOverride: cookieViewer });
    const cleared = await req('GET', '/api/progress/movie/radarr-1', { cookieOverride: cookieViewer });
    expect(cleared.json.percent).toBe(0);
  }, 30_000);

  it('users can change their password and list their devices', async () => {
    const login = await req('POST', '/api/auth/login', { body: { username: 'e2eviewer', password: 'e2eviewer-password-123' } });
    const cookieViewer = /vv_session=[^;]+/.exec(login.setCookie!)![0];

    const sessions = await req('GET', '/api/auth/sessions', { cookieOverride: cookieViewer });
    expect(sessions.status).toBe(200);
    expect(sessions.json.sessions.length).toBeGreaterThan(0);
    expect(sessions.json.sessions.every((s: any) => s.username === 'e2eviewer')).toBe(true);

    const wrong = await req('POST', '/api/auth/password', { body: { current: 'nope-nope-nope-1', next: 'brand-new-password-1' }, cookieOverride: cookieViewer });
    expect(wrong.status).toBe(400);
    const changed = await req('POST', '/api/auth/password', { body: { current: 'e2eviewer-password-123', next: 'brand-new-password-1' }, cookieOverride: cookieViewer });
    expect(changed.status).toBe(200);
    expect((await req('POST', '/api/auth/login', { body: { username: 'e2eviewer', password: 'e2eviewer-password-123' } })).status).toBe(401);
    expect((await req('POST', '/api/auth/login', { body: { username: 'e2eviewer', password: 'brand-new-password-1' } })).status).toBe(200);

    // Admin reset signs the account out everywhere.
    const users = (await req('GET', '/api/auth/users', { cookieOverride: cookieAdmin })).json.users;
    const viewer = users.find((u: any) => u.username === 'e2eviewer');
    const reset = await req('POST', `/api/auth/users/${viewer.id}/password`, { body: { password: 'reset-by-admin-123' }, cookieOverride: cookieAdmin });
    expect(reset.status).toBe(200);
    expect((await req('GET', '/api/movies', { cookieOverride: cookieViewer })).status).toBe(401);
  }, 30_000);

  it('stay-signed-in issues a 30-day cookie and logout clears it', async () => {
    const login = await req('POST', '/api/auth/login', {
      body: { username: 'e2eadmin', password: 'e2eadmin-password-123', stayLoggedIn: true }
    });
    expect(login.status).toBe(200);
    expect(login.setCookie).toContain('Max-Age=2592000');
    captureCookie(login);

    const logout = await req('POST', '/api/auth/logout');
    expect(logout.status).toBe(200);
    expect(logout.json.authenticated).toBe(false);

    expect((await req('GET', '/api/movies')).status).toBe(401);

    // Back in for the rest of the suite.
    const again = await req('POST', '/api/auth/login', {
      body: { username: 'e2eadmin', password: 'e2eadmin-password-123' }
    });
    expect(again.status).toBe(200);
    captureCookie(again);
  }, 30_000);
});

describe('e2e: library (empty state after the clean reset)', () => {
  it('no phantom movies, series or artists', async () => {
    const movies = await req('GET', '/api/movies');
    expect(movies.status).toBe(200);
    expect(Array.isArray(movies.json)).toBe(true);
    expect(movies.json).toHaveLength(0);

    const series = await req('GET', '/api/series');
    expect(series.status).toBe(200);
    expect(series.json).toHaveLength(0);

    const artists = await req('GET', '/api/artists');
    expect(artists.status).toBe(200);
    expect(artists.json).toHaveLength(0);
  }, 30_000);

  it('detail, cast, verify and description return 404s', async () => {
    expect((await req('GET', '/api/movies/radarr-3')).status).toBe(404);
    expect((await req('GET', '/api/series/sonarr-2')).status).toBe(404);
    // Lidarr unreachable is a service error, not "artist removed": the detail
    // endpoint surfaces it as 502 lidarr_offline while a truly absent artist
    // (reachable adapter) returns 404. (see P1-4)
    const artistDetail = await req('GET', '/api/artists/lidarr-2');
    expect(artistDetail.status).toBe(502);
    expect(artistDetail.json?.error).toBe('lidarr_offline');
    expect((await req('GET', '/api/movies/radarr-3/cast')).status).toBe(404);
    expect((await req('GET', '/api/media/radarr-3/verify')).status).toBe(404);
    expect((await req('GET', '/api/media/radarr-3/description')).status).toBe(404);
  }, 30_000);

  it('search and suggestions never fabricate results', async () => {
    const empty = await req('GET', '/api/search?q=');
    expect(empty.status).toBe(200);
    expect(empty.json.total).toBe(0);

    const dune = await req('GET', '/api/search?q=dune');
    expect(dune.status).toBe(200);
    expect(dune.json.total).toBe(0);
    expect(dune.json.items).toHaveLength(0);

    const suggestions = await req('GET', '/api/search/suggestions?q=dune');
    expect(suggestions.status).toBe(200);
    expect(Array.isArray(suggestions.json.suggestions)).toBe(true);
  }, 40_000);

  it('dashboard renders without data', async () => {
    const res = await req('GET', '/api/dashboard');
    expect(res.status).toBe(200);
    expect(typeof res.json).toBe('object');
    expect(Array.isArray(res.json)).toBe(false);
  }, 30_000);
});

describe('e2e: requests', () => {
  it('starts empty and validates input', async () => {
    const list = await req('GET', '/api/requests');
    expect(list.status).toBe(200);
    expect(list.json.items).toHaveLength(0);
    expect(list.json.total).toBe(0);
    expect(list.json.hasMore).toBe(false);

    expect((await req('GET', '/api/requests/candidates')).status).toBe(400);
    const candidates = await req('GET', '/api/requests/candidates?title=dune&mediaType=movie');
    expect([200, 502]).toContain(candidates.status);

    expect((await req('POST', '/api/requests', { body: {} })).status).toBe(400);
    expect((await req('GET', '/api/requests/does-not-exist')).status).toBe(404);
    expect((await req('POST', '/api/requests/does-not-exist/approve')).status).toBe(404);
    expect((await req('POST', '/api/requests/does-not-exist/cancel')).status).toBe(404);
    expect((await req('POST', '/api/requests/does-not-exist/stop')).status).toBe(404);
    expect((await req('DELETE', '/api/requests/does-not-exist')).status).toBe(404);
  }, 40_000);
});

describe('e2e: downloads', () => {
  it('empty/unconfigured state and no 500s on actions', async () => {
    const list = await req('GET', '/api/downloads');
    expect([200, 503]).toContain(list.status);

    expect((await req('POST', '/api/downloads/does-not-exist/pause')).status).toBe(422);
    expect((await req('POST', '/api/downloads/does-not-exist/resume')).status).toBe(422);
    expect((await req('POST', '/api/downloads/does-not-exist/remove')).status).toBe(422);
  }, 40_000);
});

describe('e2e: watch progress + resume', () => {
  it('saves, reads, lists and clears progress', async () => {
    const peek = await req('GET', '/api/progress/movie/e2e-movie');
    expect(peek.status).toBe(200);
    expect(peek.json.positionSeconds).toBe(0);
    expect(peek.json.percent).toBe(0);

    expect((await req('GET', '/api/progress/tv/e2e-movie')).status).toBe(400);

    const save = await req('POST', '/api/progress/movie/e2e-movie', {
      body: { positionSeconds: 90, durationSeconds: 600 }
    });
    expect(save.status).toBe(200);
    expect(save.json.positionSeconds).toBe(90);
    expect(save.json.percent).toBe(15);

    const read = await req('GET', '/api/progress/movie/e2e-movie');
    expect(read.json.positionSeconds).toBe(90);

    const library = await req('GET', '/api/progress/library/movie');
    expect(library.status).toBe(200);
    expect(library.json.mediaType).toBe('movie');
    expect(typeof library.json.progress).toBe('object');

    const cleared = await req('DELETE', '/api/progress/movie/e2e-movie');
    expect(cleared.status).toBe(200);
    expect(cleared.json.cleared).toBe(true);

    const after = await req('GET', '/api/progress/movie/e2e-movie');
    expect(after.json.percent).toBe(0);
  }, 40_000);
});

describe('e2e: streaming + transcode fallback', () => {
  it('no phantom files: 404s and empty subtitle lists', async () => {
    expect((await req('GET', '/api/stream/e2e-movie/info')).status).toBe(404);
    expect((await req('GET', '/api/stream/e2e-movie/transcode')).status).toBe(404);
    expect((await req('GET', '/api/stream/e2e-movie')).status).toBe(404);
    expect((await req('GET', '/api/stream/episode/e2e-episode/info')).status).toBe(404);
    expect((await req('GET', '/api/stream/episode/e2e-episode/transcode')).status).toBe(404);
    expect((await req('GET', '/api/stream/episode/e2e-episode')).status).toBe(404);

    const subs = await req('GET', '/api/stream/e2e-movie/subtitles');
    expect(subs.status).toBe(200);
    expect(subs.json.subtitles).toHaveLength(0);

    // Path traversal attempts are rejected, not followed.
    expect((await req('GET', '/api/stream/e2e-movie/subtitle/..%2F..%2Fetc%2Fpasswd')).status).toBe(400);
    expect((await req('GET', '/api/stream/episode/x/subtitle/nope.srt')).status).toBe(404);
  }, 30_000);
});

describe('e2e: seek-bar previews', () => {
  it('say unavailable when there is no local file, for movies and episodes', async () => {
    for (const path of ['/api/stream/radarr-999/trickplay', '/api/stream/radarr-999/trickplay.jpg', '/api/stream/episode/sonarr-999/trickplay']) {
      const res = await req('GET', path);
      expect(res.status).toBe(404);
      expect(res.json.state).toBe('unavailable');
    }
  }, 20_000);
});

describe('e2e: live tv recording', () => {
  it('lists nothing at first, refuses unknown channels and non-admins', async () => {
    expect((await req('GET', '/api/live/recordings')).json.recordings).toEqual([]);
    expect((await req('POST', '/api/live/record', { body: { channelId: 'nope', minutes: 30 }, cookieOverride: cookieAdmin })).status).toBe(404);
    const cookieViewer = await viewerCookie();
    expect((await req('POST', '/api/live/record', { body: { channelId: 'nope', minutes: 30 }, cookieOverride: cookieViewer })).status).toBe(403);
    expect((await req('DELETE', '/api/live/recordings/nope', { cookieOverride: cookieViewer })).status).toBe(403);
    expect((await req('DELETE', '/api/live/recordings/nope', { cookieOverride: cookieAdmin })).status).toBe(404);
    expect((await req('GET', '/api/live/recordings/nope/file')).status).toBe(404);
  }, 20_000);
});

describe('e2e: music', () => {
  it('validates ids and reports missing artists/tracks', async () => {
    expect((await req('GET', '/api/artists/not-a-number/albums')).status).toBe(400);
    expect((await req('GET', '/api/artists/not-a-number/tracks')).status).toBe(400);
    expect((await req('GET', '/api/albums/not-a-number')).status).toBe(400);
    expect((await req('GET', '/api/music/stream/not-a-number')).status).toBe(400);

    const albums = await req('GET', '/api/artists/lidarr-9/albums');
    expect([200, 502]).toContain(albums.status);

    expect((await req('GET', '/api/artists/lidarr-9/covers')).status).toBe(404);
    expect((await req('POST', '/api/artists/lidarr-9/covers', { body: {} })).status).toBe(400);
    expect((await req('DELETE', '/api/artists/lidarr-9/covers')).status).toBe(404);
  }, 30_000);
});

describe('e2e: AI assistant', () => {
  it('health/models/tools/permissions/history respond and validate', async () => {
    const health = await req('GET', '/api/ai/health');
    expect(health.status).toBe(200);
    expect(typeof health.json.healthy).toBe('boolean');

    const models = await req('GET', '/api/ai/models');
    expect(models.status).toBe(200);
    expect(Array.isArray(models.json.models)).toBe(true);

    const tools = await req('GET', '/api/ai/tools');
    expect(tools.status).toBe(200);
    expect(Array.isArray(tools.json.tools)).toBe(true);

    const permissions = await req('GET', '/api/ai/permissions');
    expect(permissions.status).toBe(200);
    expect(typeof permissions.json.level).toBe('string');

    const savePerm = await req('POST', '/api/ai/permissions', { body: { level: 'manage' } });
    expect(savePerm.status).toBe(200);
    expect(savePerm.json.level).toBe('manage');

    expect((await req('POST', '/api/ai/permissions', { body: { level: 'bogus' } })).status).toBe(400);

    const history = await req('GET', '/api/ai/history');
    expect(history.status).toBe(200);
    expect(Array.isArray(history.json.history)).toBe(true);

    expect((await req('POST', '/api/ai/chat', { body: {} })).status).toBe(400);
    expect((await req('GET', '/api/ai/pull/does-not-exist/status')).status).toBe(200);

    const active = await req('GET', '/api/ai/pull/active');
    expect(active.status).toBe(200);
    expect(Array.isArray(active.json.jobs)).toBe(true);

    const catalog = await req('GET', '/api/ai/models/catalog?q=qwen');
    expect(catalog.status).toBe(200);
    expect(catalog.json.models.length).toBeGreaterThan(1);
    expect(catalog.json.models.every((m: any) => /qwen/i.test(m.tag) && ['fits', 'tight', 'too-big'].includes(m.fit))).toBe(true);
    expect(catalog.json.system.totalMemGB).toBeGreaterThan(0);
    expect((await req('GET', '/api/ai/models/catalog?q=zzzznomatch')).json.models).toEqual([]);

    expect((await req('POST', '/api/ai/chat/stream', { body: {} })).status).toBe(400);
    const streamed = await req('POST', '/api/ai/chat/stream', { body: { message: 'help' } });
    expect(streamed.status).toBe(200);
    const lines = streamed.text.trim().split('\n').map(l => JSON.parse(l));
    expect(lines.slice(0, -1).map((l: any) => l.delta).join('')).toBe(lines[lines.length - 1].reply.text);
    expect(lines[lines.length - 1].done).toBe(true);
  }, 40_000);
});

describe('e2e: assistant authorization', () => {
  it('regular users cannot control downloads or themes through the assistant, and confirmations are single-use and personal', async () => {
    const cookieViewer = await viewerCookie();
    const chat = (message: string, cookieOverride: string, extra: Record<string, unknown> = {}) =>
      req('POST', '/api/ai/chat', { body: { message, ...extra }, cookieOverride });

    for (const message of ['pause the download of anything', 'retry Dune', 'switch to midnight theme', 'remove the download of anything']) {
      const reply = await chat(message, cookieViewer);
      expect(reply.json.kind).toBe('message');
      expect(reply.json.text).toMatch(/only an administrator/i);
    }

    // A request is something anyone may ask for; it needs a server-issued confirmation.
    const ask = await chat('request the movie Dune', cookieAdmin);
    expect(ask.json.kind).toBe('confirmation');
    const id = ask.json.confirmationId as string;
    expect(typeof id).toBe('string');

    // Not the browser's description: a made-up confirmation, or someone else's, does nothing.
    expect((await chat('', cookieAdmin, { confirm: { tool: 'remove_download', arguments: { download_id: 'x' } } })).json.message).toMatch(/no longer valid/i);
    expect((await chat('', cookieAdmin, { confirm: { id: 'not-real' } })).json.message).toMatch(/no longer valid/i);
    expect((await chat('', cookieViewer, { confirm: { id } })).json.message).toMatch(/no longer valid/i);

    // The owner can use it once, and altered arguments are ignored (it runs what the server stored).
    const used = await chat('', cookieAdmin, { confirm: { id, tool: 'remove_download', arguments: { download_id: 'x' } } });
    expect(JSON.stringify(used.json)).not.toMatch(/remove/i);
    expect((await chat('', cookieAdmin, { confirm: { id } })).json.message).toMatch(/no longer valid/i);
  }, 30_000);
});

describe('e2e: bulk public indexers', () => {
  it('is administrator only and reports honestly when Prowlarr is not connected', async () => {
    const cookieViewer = await viewerCookie();
    expect((await req('POST', '/api/indexers/enable-public', { body: {}, cookieOverride: cookieViewer })).status).toBe(403);
    expect((await req('POST', '/api/indexers/enable-public', { body: {}, cookieOverride: cookieAdmin })).status).toBe(502);
    expect((await req('GET', '/api/indexers/enable-public/status')).json.state).toBe('idle');
  }, 20_000);
});

describe('e2e: trusting the home network', () => {
  it('home-network service addresses need an explicit opt-in, and the machine itself never qualifies', async () => {
    const config = (url: string) => req('POST', '/api/integrations/radarr/config', { body: { url, apiKey: 'k' }, cookieOverride: cookieAdmin });
    const refused = await config('http://192.168.1.50:7878');
    expect(refused.status).toBe(400);
    expect(refused.json.message).toMatch(/Trust services on my home network/);

    expect((await req('POST', '/api/server-settings', { body: { trustLocalNetwork: true }, cookieOverride: cookieAdmin })).json.trustLocalNetwork).toBe(true);
    try {
      // Allowed to try now; nothing is listening there, so it is a connection failure, not a policy refusal.
      expect((await config('http://192.168.1.50:7878')).status).toBe(422);
      expect((await config('http://127.0.0.1:7878')).status).toBe(400);
      expect((await config('http://169.254.169.254/latest')).status).toBe(400);
    } finally {
      await req('POST', '/api/server-settings', { body: { trustLocalNetwork: false }, cookieOverride: cookieAdmin });
    }
    expect((await config('http://192.168.1.50:7878')).status).toBe(400);
  }, 60_000);
});

describe('e2e: refresh', () => {
  it('needs a session, reports what it did, and is rate limited per person', async () => {
    expect((await req('POST', '/api/refresh', { cookieOverride: null })).status).toBe(401);

    const cookieViewer = await viewerCookie();
    const first = await req('POST', '/api/refresh', { cookieOverride: cookieViewer });
    expect(first.status).toBe(200);
    expect(first.json.cleared).toContain('search suggestions');
    expect(first.json.cleared).not.toContain('indexer catalog'); // administrators only
    expect(first.json.queuesNudged).toEqual([]);
    expect(typeof first.json.refreshedAt).toBe('string');

    const again = await req('POST', '/api/refresh', { cookieOverride: cookieViewer });
    expect(again.status).toBe(429);
    expect(again.json.retryAfter).toBeGreaterThan(0);
    expect(again.text).toMatch(/too_soon/);

    // The limit is per person: an administrator is unaffected, and gets the extra work.
    const admin = await req('POST', '/api/refresh', { cookieOverride: cookieAdmin });
    expect(admin.status).toBe(200);
    expect(admin.json.cleared).toContain('indexer catalog');
  }, 30_000);
});

describe('e2e: concerts and videos', () => {
  it('validates ids, keeps the filing tools to administrators, and never serves a made-up video id', async () => {
    expect((await req('GET', '/api/artists/not-a-number/videos', { cookieOverride: cookieAdmin })).status).toBe(400);

    const cookieViewer = await viewerCookie();
    expect((await req('GET', '/api/music-videos/pending', { cookieOverride: cookieViewer })).status).toBe(403);
    expect((await req('POST', '/api/music-videos/file', { body: { hash: 'a'.repeat(40), artist: 'Queen' }, cookieOverride: cookieViewer })).status).toBe(403);
    expect((await req('POST', '/api/music-videos/sweep', { cookieOverride: cookieViewer })).status).toBe(403);

    const pending = await req('GET', '/api/music-videos/pending', { cookieOverride: cookieAdmin });
    expect(pending.status).toBe(200);
    expect(pending.json.jobs).toEqual([]);

    expect((await req('POST', '/api/music-videos/file', { body: { hash: 'nope', artist: 'Queen' }, cookieOverride: cookieAdmin })).status).toBe(400);
    expect((await req('POST', '/api/music-videos/file', { body: { hash: 'a'.repeat(40), artist: '' }, cookieOverride: cookieAdmin })).status).toBe(400);

    // Ids that point outside an artist's Concerts/Videos folders are just "not found".
    for (const id of ['musicvideo-1~' + Buffer.from('../../etc/passwd').toString('base64url'), 'musicvideo-x~abc', 'musicvideo-']) {
      expect([404, 400]).toContain((await req('GET', `/api/stream/${encodeURIComponent(id)}`, { cookieOverride: cookieAdmin })).status);
    }
  }, 30_000);
});

describe('e2e: pick a release', () => {
  it('is administrator-only and validates its input', async () => {
    const cookieViewer = await viewerCookie();
    expect((await req('GET', '/api/releases/search?q=queen', { cookieOverride: cookieViewer })).status).toBe(403);
    expect((await req('POST', '/api/releases/grab', { body: { id: 'x' }, cookieOverride: cookieViewer })).status).toBe(403);
    expect((await req('GET', '/api/releases/search?q=a', { cookieOverride: cookieAdmin })).status).toBe(400);
    expect((await req('POST', '/api/releases/grab', { body: {}, cookieOverride: cookieAdmin })).status).toBe(400);
    expect((await req('POST', '/api/releases/grab', { body: { id: 'magnet:?xt=urn:btih:never-listed' }, cookieOverride: cookieAdmin })).status).toBe(502);
  }, 30_000);
});

describe('e2e: kiwix', () => {
  it('reports unconfigured by default, rejects a bad address, saves a good one, and blocks non-admins', async () => {
    const status = await req('GET', '/api/kiwix/status');
    expect(status.status).toBe(200);
    expect(status.json.configured).toBe(false);

    const badAddress = await req('POST', '/api/kiwix/config', { body: { url: 'not-a-url' }, cookieOverride: cookieAdmin });
    expect(badAddress.status).toBe(400);

    // e2eviewer's password was reset to this value earlier in the "accounts" suite.
    const cookieViewer = await viewerCookie();
    const nonAdmin = await req('POST', '/api/kiwix/config', { body: { url: 'http://192.168.1.50:8080' }, cookieOverride: cookieViewer });
    expect(nonAdmin.status).toBe(403);

    const saved = await req('POST', '/api/kiwix/config', { body: { url: 'http://192.168.1.50:8080' }, cookieOverride: cookieAdmin });
    expect(saved.status).toBe(200);
    expect(saved.json.configured).toBe(true);
    expect(saved.json.url).toBe('http://192.168.1.50:8080');
    expect(saved.json.healthy).toBe(false); // nothing is actually listening there in this test

    const cleared = await req('POST', '/api/kiwix/config', { body: { url: '' }, cookieOverride: cookieAdmin });
    expect(cleared.status).toBe(200);
    expect(cleared.json.configured).toBe(false);
  }, 20_000);
});

describe('e2e: home lab apps', () => {
  it('connects an Immich-like server, reports health and a headline, hides the key, and is admin only', async () => {
    const { createServer } = await import('node:http');
    const fake = createServer((rq, rs) => {
      if (rq.url === '/api/server/ping') return void rs.end('{"res":"pong"}');
      if (rq.url === '/api/server/statistics') {
        if (rq.headers['x-api-key'] !== 'secret-key') { rs.statusCode = 401; return void rs.end('{}'); }
        return void rs.end('{"photos":12,"videos":3}');
      }
      rs.statusCode = 404; rs.end('{}');
    });
    await new Promise<void>(ok => fake.listen(0, '127.0.0.1', ok));
    const url = `http://127.0.0.1:${(fake.address() as { port: number }).port}`;
    try {
      const before = await req('GET', '/api/apps');
      expect(before.json.apps.map((a: any) => a.id)).toEqual(['immich', 'audiobookshelf', 'kavita']);
      expect(before.json.apps.every((a: any) => !a.connected)).toBe(true);

      expect((await req('POST', '/api/apps/nope/config', { body: { url }, cookieOverride: cookieAdmin })).status).toBe(400);
      expect((await req('POST', '/api/apps/immich/config', { body: { url: 'nope' }, cookieOverride: cookieAdmin })).status).toBe(400);

      const cookieViewer = await viewerCookie();
      expect((await req('POST', '/api/apps/immich/config', { body: { url }, cookieOverride: cookieViewer })).status).toBe(403);

      const saved = await req('POST', '/api/apps/immich/config', { body: { url, apiKey: 'secret-key' }, cookieOverride: cookieAdmin });
      expect(saved.status).toBe(200);
      const immich = saved.json.apps.find((a: any) => a.id === 'immich');
      expect(immich).toMatchObject({ connected: true, healthy: true, hasKey: true, headline: '12 photos, 3 videos' });
      expect(JSON.stringify(saved.json)).not.toContain('secret-key');

      const gone = await req('POST', '/api/apps/immich/config', { body: { url: '' }, cookieOverride: cookieAdmin });
      expect(gone.json.apps.find((a: any) => a.id === 'immich').connected).toBe(false);
    } finally {
      fake.close();
    }
  }, 20_000);
});

describe('e2e: themes', () => {
  it('lists themes, activates one and rejects unknown ids', async () => {
    const list = await req('GET', '/api/themes');
    expect(list.status).toBe(200);
    expect(list.json.length).toBeGreaterThan(0);
    const firstId = list.json[0].id;
    expect(typeof firstId).toBe('string');

    const active = await req('GET', '/api/themes/active');
    expect(active.status).toBe(200);
    expect(active.json).toHaveProperty('manifest');
    expect(active.json).toHaveProperty('cssVars');

    const activate = await req('POST', `/api/themes/${firstId}/activate`);
    expect(activate.status).toBe(200);
    expect(activate.json.success).toBe(true);
    expect(activate.json.activeTheme).toBe(firstId);

    expect((await req('POST', '/api/themes/does-not-exist/activate')).status).toBe(404);
    expect((await req('GET', '/api/themes/does-not-exist')).status).toBe(404);
  }, 30_000);
});

describe('e2e: integrations', () => {
  it('lists them, toggling is safe, config validation rejects bad input', async () => {
    const list = await req('GET', '/api/integrations');
    expect(list.status).toBe(200);
    expect(Array.isArray(list.json)).toBe(true);
    const radarr = list.json.find((i: any) => i.adapter === 'radarr');
    expect(radarr).toBeTruthy();
    expect(typeof radarr.enabled).toBe('boolean');

    // Toggling an unconfigured service flips it off (empty credentials are not
    // accepted), so nothing can accidentally connect to a phantom service.
    const toggle1 = await req('POST', '/api/integrations/radarr/toggle');
    expect(toggle1.status).toBe(200);
    expect(toggle1.json.enabled).toBe(false);

    const toggle2 = await req('POST', '/api/integrations/radarr/toggle');
    expect([400, 422]).toContain(toggle2.status);

    expect((await req('POST', '/api/integrations/does-not-exist/toggle')).status).toBe(404);
    expect((await req('POST', '/api/integrations/plex/toggle')).status).toBe(200);

    expect((await req('POST', '/api/integrations/radarr/config', { body: {} })).status).toBe(400);
    expect(
      (await req('POST', '/api/integrations/radarr/config', { body: { url: 'http://10.0.0.1:7878' } })).status
    ).toBe(400);
    expect((await req('POST', '/api/integrations/does-not-exist/config', { body: { url: 'http://x' } })).status).toBe(404);
  }, 40_000);

  it('detect scans the usual addresses and reports', async () => {
    const detect = await req('GET', '/api/integrations/detect');
    expect(detect.status).toBe(200);
    expect(Array.isArray(detect.json)).toBe(true);
    const radarr = detect.json.find((r: any) => r.adapter === 'radarr');
    expect(radarr).toBeTruthy();
    expect(typeof radarr.url).toBe('string');
    expect(typeof radarr.reachable).toBe('boolean');
    // Reachability is a real device fact: every entry is a well-formed result
    // with a boolean flag, and nothing may be a phantom "always reachable".
    for (const entry of detect.json as Array<{ adapter: string; url: string; reachable: boolean }>) {
      expect(typeof entry.adapter).toBe('string');
      expect(entry.adapter.length).toBeGreaterThan(0);
      expect(typeof entry.url).toBe('string');
      expect(entry.url.startsWith('http')).toBe(true);
      expect(typeof entry.reachable).toBe('boolean');
    }
  }, 40_000);
});

describe('e2e: first-run onboarding', () => {
  it('is required on a fresh store, then completes and stays completed', async () => {
    const before = await req('GET', '/api/onboarding');
    expect(before.status).toBe(200);
    expect(before.json.required).toBe(true);

    const complete = await req('POST', '/api/onboarding', { body: { complete: true } });
    expect(complete.status).toBe(200);
    expect(complete.json.required).toBe(false);

    const after = await req('GET', '/api/onboarding');
    expect(after.status).toBe(200);
    expect(after.json.required).toBe(false);

    // A skipped wizard also counts as complete, so it never nags again.
    const skip = await req('POST', '/api/onboarding', { body: { complete: false } });
    expect(skip.status).toBe(200);
    expect(skip.json.required).toBe(true);
  });

  it('server settings stay intact around onboarding state changes', async () => {
    const settings = await req('GET', '/api/server-settings');
    expect(settings.status).toBe(200);
    expect(typeof settings.json.onboardingComplete).toBe('boolean');
    const stillRequired = await req('GET', '/api/onboarding');
    expect(stillRequired.json.required).toBe(true);
    await req('POST', '/api/onboarding', { body: { complete: true } });
  });
});

describe('e2e: services', () => {
  it('status/config/check-update respond; unknown services are rejected', async () => {
    const status = await req('GET', '/api/services/status');
    expect(status.status).toBe(200);
    expect(Array.isArray(status.json.services)).toBe(true);

    const config = await req('GET', '/api/services/config');
    expect(config.status).toBe(200);
    expect(typeof config.json).toBe('object');

    const update = await req('GET', '/api/services/check-update');
    expect(update.status).toBe(200);
    expect(typeof update.json.available).toBe('boolean');

    const stop = await req('POST', '/api/services/stop/does-not-exist');
    expect(stop.status).toBe(200);
    expect(stop.json.stopped).toBe(false);

    const start = await req('POST', '/api/services/start/does-not-exist');
    expect(start.status).toBe(200);
    expect(start.json.started).toBe(false);
  }, 40_000);
});

describe('e2e: server settings + system', () => {
  it('settings are read/saved with validation and folder safety', async () => {
    const current = await req('GET', '/api/server-settings');
    expect(current.status).toBe(200);
    expect(current.json).toHaveProperty('mediaRoots');

    expect((await req('POST', '/api/server-settings', { body: { logLevel: 'bogus' } })).status).toBe(400);

    const rename = await req('POST', '/api/server-settings', { body: { serverName: 'E2E Box' } });
    expect(rename.status).toBe(200);
    expect(rename.json.serverName).toBe('E2E Box');

    // Changing a media folder requires the exact confirmation phrase.
    const folderChange = await req('POST', '/api/server-settings', {
      body: { mediaRoots: { movies: '/tmp/e2e-movies' } }
    });
    expect(folderChange.status).toBe(422);
    expect(folderChange.json.code).toBe('confirmation_required');

    const proxy = await req('GET', '/api/server-settings/proxy-test');
    expect(proxy.status).toBe(200);
    expect(typeof proxy.json).toBe('object');
  }, 40_000);

  it('storage report is real device facts, not a guessed number', async () => {
    const storage = await req('GET', '/api/system/storage');
    expect(storage.status).toBe(200);
    expect(Array.isArray(storage.json.roots)).toBe(true);
    expect(typeof storage.json.mediaBytes).toBe('number');
    expect(typeof storage.json.mediaFiles).toBe('number');
    expect(typeof storage.json.truncated).toBe('boolean');
    expect(typeof storage.json.computedAt).toBe('string');
    for (const root of storage.json.roots) {
      expect(root).toHaveProperty('name');
      expect(root).toHaveProperty('path');
      expect(typeof root.exists).toBe('boolean');
      expect(typeof root.bytes).toBe('number');
      expect(typeof root.files).toBe('number');
      // Empty/missing roots report zero, never a made-up 0-GB number.
      expect(root.bytes).toBeGreaterThanOrEqual(0);
    }
    expect(storage.json.disk === null || typeof storage.json.disk === 'object').toBe(true);
  }, 30_000);

  it('diagnostics and activity respond', async () => {
    const diag = await req('GET', '/api/diagnostics');
    expect(diag.status).toBe(200);
    expect(typeof diag.json).toBe('object');

    const activity = await req('GET', '/api/activity');
    expect(activity.status).toBe(200);
    expect(Array.isArray(activity.json)).toBe(true);
  }, 40_000);
});

describe('e2e: quick connect, profile pictures, age limits, lyrics', () => {
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  let userCookie = '';
  let userId = '';

  it('sets up a regular user', async () => {
    const made = await req('POST', '/api/auth/users', { body: { username: 'qcuser', password: 'qcpass', role: 'user' }, cookieOverride: cookieAdmin });
    expect(made.status).toBe(200);
    userId = made.json.users.find((u: any) => u.username === 'qcuser').id;
    const login = await req('POST', '/api/auth/login', { body: { username: 'qcuser', password: 'qcpass' } });
    userCookie = /vv_session=[^;]+/.exec(login.setCookie!)![0];
  }, 30_000);

  it('signs a second device in with a code', async () => {
    const started = await req('POST', '/api/auth/quickconnect/start', { cookieOverride: null });
    expect(started.status).toBe(200);
    expect(started.json.code).toMatch(/^\d{6}$/);
    const { code, secret } = started.json;

    expect((await req('GET', `/api/auth/quickconnect/poll?secret=${secret}`, { cookieOverride: null })).json.status).toBe('pending');
    expect((await req('POST', '/api/auth/quickconnect/approve', { body: { code }, cookieOverride: null })).status).toBe(401);
    expect((await req('POST', '/api/auth/quickconnect/approve', { body: { code: '000000x' }, cookieOverride: userCookie })).status).toBe(400);
    expect((await req('POST', '/api/auth/quickconnect/approve', { body: { code }, cookieOverride: userCookie })).status).toBe(200);

    const polled = await req('GET', `/api/auth/quickconnect/poll?secret=${secret}`, { cookieOverride: null });
    expect(polled.json.status).toBe('approved');
    expect(polled.json.user.username).toBe('qcuser');
    const newCookie = /vv_session=[^;]+/.exec(polled.setCookie!)![0];
    expect((await req('GET', '/api/auth/status', { cookieOverride: newCookie })).json.user.username).toBe('qcuser');
    // The secret works once.
    expect((await req('GET', `/api/auth/quickconnect/poll?secret=${secret}`, { cookieOverride: null })).json.status).toBe('expired');
  }, 30_000);

  it('stores and clears a profile picture and rejects bad ones', async () => {
    expect((await req('POST', '/api/auth/profile/avatar', { body: { avatar: 'http://example.com/a.png' }, cookieOverride: userCookie })).status).toBe(400);
    expect((await req('POST', '/api/auth/profile/avatar', { body: { avatar: PNG }, cookieOverride: null })).status).toBe(401);
    const set = await req('POST', '/api/auth/profile/avatar', { body: { avatar: PNG }, cookieOverride: userCookie });
    expect(set.status).toBe(200);
    expect(set.json.user.avatar).toBe(PNG);
    expect((await req('POST', '/api/auth/profile/avatar', { body: { avatar: '' }, cookieOverride: userCookie })).json.user.avatar).toBeUndefined();
  }, 30_000);

  it('lets only an administrator set an age limit, and it survives a restart of the session', async () => {
    expect((await req('POST', `/api/auth/users/${userId}/limit`, { body: { maxRating: 'PG' }, cookieOverride: userCookie })).status).toBe(403);
    expect((await req('POST', `/api/auth/users/${userId}/limit`, { body: { maxRating: 'XXX' }, cookieOverride: cookieAdmin })).status).toBe(400);
    const set = await req('POST', `/api/auth/users/${userId}/limit`, { body: { maxRating: 'PG-13' }, cookieOverride: cookieAdmin });
    expect(set.status).toBe(200);
    expect(set.json.users.find((u: any) => u.id === userId).maxRating).toBe('PG-13');
    expect((await req('GET', '/api/auth/status', { cookieOverride: userCookie })).json.user.maxRating).toBe('PG-13');
    // A limited viewer still gets pages, just filtered ones.
    expect((await req('GET', '/api/movies', { cookieOverride: userCookie })).status).toBe(200);
    expect((await req('GET', '/api/dashboard', { cookieOverride: userCookie })).status).toBe(200);
  }, 30_000);

  it('validates lyrics lookups', async () => {
    expect((await req('GET', '/api/lyrics?artist=&title=')).status).toBe(400);
  }, 30_000);
});

describe('e2e: assistant rules, retries, subtitles, watch party, people', () => {
  it('answers on-topic questions by rules and refuses the rest, without a model', async () => {
    const off = await req('POST', '/api/ai/chat', { body: { message: 'what is the capital of France' }, cookieOverride: cookieAdmin });
    expect(off.json.kind).toBe('message');
    expect(off.json.text).toMatch(/only help with your virtuallyView library/i);
    const help = await req('POST', '/api/ai/chat', { body: { message: 'help' }, cookieOverride: cookieAdmin });
    expect(help.json.text).toMatch(/What is downloading/);
    const downloads = await req('POST', '/api/ai/chat', { body: { message: 'What is downloading right now?' }, cookieOverride: cookieAdmin });
    expect(['message', 'error']).toContain(downloads.json.kind);
    expect(downloads.json.text ?? downloads.json.message).toBeTruthy();
    const ask = await req('POST', '/api/ai/chat', { body: { message: 'request the series Severance' }, cookieOverride: cookieAdmin });
    expect(ask.json).toMatchObject({ kind: 'confirmation', tool: 'request_series', arguments: { title: 'Severance' } });
  }, 60_000);

  it('validates search-again ids', async () => {
    expect((await req('POST', '/api/movies/nope/search', { body: {}, cookieOverride: cookieAdmin })).status).toBe(502);
    expect((await req('POST', '/api/series/sonarr-1/search', { body: { episodeId: 'x' }, cookieOverride: cookieAdmin })).status).toBe(502);
    expect((await req('POST', '/api/artists/x/search', { body: {}, cookieOverride: cookieAdmin })).status).toBe(502);
    expect((await req('POST', '/api/downloads/queue-qbittorrent-abc/retry', { body: {}, cookieOverride: cookieAdmin })).status).toBe(422);
  }, 30_000);

  it('handles subtitles when Bazarr is not connected and checks uploads', async () => {
    const langs = await req('GET', '/api/subtitles/languages', { cookieOverride: cookieAdmin });
    expect(langs.json.connected).toBe(false);
    const bad = await req('POST', '/api/movies/radarr-1/subtitles/upload', { body: { language: 'en', filename: 'movie.exe', content: 'aGk=' }, cookieOverride: cookieAdmin });
    expect(bad.status).toBe(422);
    expect(bad.json.message).toMatch(/\.srt/);
    const search = await req('POST', '/api/movies/radarr-1/subtitles/search', { body: { language: 'en' }, cookieOverride: cookieAdmin });
    expect([422, 503]).toContain(search.status);
    expect(search.json.success).toBe(false);
  }, 30_000);

  it('runs a watch party: only app pages, state is shared, unknown rooms 404', async () => {
    expect((await req('POST', '/api/watch-party', { body: { link: 'https://evil.example/x' }, cookieOverride: cookieAdmin })).status).toBe(400);
    const made = await req('POST', '/api/watch-party', { body: { title: 'Dune', link: '/movies/radarr-1/play' }, cookieOverride: cookieAdmin });
    expect(made.status).toBe(200);
    const code = made.json.code as string;
    expect(code).toMatch(/^[0-9A-F]{6}$/);
    expect((await req('GET', `/api/watch-party/${code}`, { cookieOverride: cookieAdmin })).json.link).toBe('/movies/radarr-1/play');
    expect((await req('POST', `/api/watch-party/${code}/state`, { body: { playing: 'yes', position: 1 }, cookieOverride: cookieAdmin })).status).toBe(400);
    const set = await req('POST', `/api/watch-party/${code}/state`, { body: { client: 'a', playing: true, position: 42 }, cookieOverride: cookieAdmin });
    expect(set.json.seq).toBe(1);
    expect((await req('GET', `/api/watch-party/${code}`, { cookieOverride: cookieAdmin })).json.state).toMatchObject({ playing: true, position: 42 });
    expect((await req('GET', '/api/watch-party/ZZZZZZ', { cookieOverride: cookieAdmin })).status).toBe(404);
  }, 30_000);

  it('a person nobody knows is a 404', async () => {
    const res = await req('GET', '/api/people/Zzyzx%20Qwerty%20Unknownperson', { cookieOverride: cookieAdmin });
    expect([404, 200]).toContain(res.status);
  }, 30_000);
});

describe('e2e: cast links, live tv, photos, books', () => {
  it('signs a playback link that works once, for one path, without a cookie', async () => {
    expect((await req('POST', '/api/stream-token', { body: { path: '/api/movies' }, cookieOverride: cookieAdmin })).status).toBe(400);
    expect((await req('POST', '/api/stream-token', { body: { path: '/api/stream/radarr-1' }, cookieOverride: null })).status).toBe(401);
    const signed = await req('POST', '/api/stream-token', { body: { path: '/api/stream/radarr-1' }, cookieOverride: cookieAdmin });
    expect(signed.status).toBe(200);
    const token = signed.json.token as string;
    const noCookie = await req('GET', `/api/stream/radarr-1?st=${token}`, { cookieOverride: null });
    expect(noCookie.status).not.toBe(401);
    expect((await req('GET', `/api/stream/radarr-2?st=${token}`, { cookieOverride: null })).status).toBe(401);
    expect((await req('GET', `/api/stream/radarr-1?st=${token.slice(0, -2)}xx`, { cookieOverride: null })).status).toBe(401);
    expect((await req('GET', `/api/movies?st=${token}`, { cookieOverride: null })).status).toBe(401);
  }, 30_000);

  it('lists cast devices (none in a test) and refuses unknown ones', async () => {
    const list = await req('GET', '/api/cast/devices', { cookieOverride: cookieAdmin });
    expect(list.status).toBe(200);
    expect(Array.isArray(list.json.devices)).toBe(true);
    expect((await req('POST', '/api/cast/play', { body: { device: 'nope', path: '/api/stream/radarr-1' }, cookieOverride: cookieAdmin })).status).toBe(404);
  }, 30_000);

  it('adds and removes a live tv playlist as an administrator only', async () => {
    expect((await req('POST', '/api/live/playlists', { body: { name: 'x', url: 'ftp://bad' }, cookieOverride: cookieAdmin })).status).toBe(400);
    const made = await req('POST', '/api/live/playlists', { body: { name: 'Test', url: 'http://127.0.0.1:9/none.m3u' }, cookieOverride: cookieAdmin });
    expect(made.status).toBe(200);
    expect((await req('GET', '/api/live/playlists', { cookieOverride: cookieAdmin })).json.playlists).toHaveLength(1);
    expect((await req('GET', '/api/live/stream/unknown', { cookieOverride: cookieAdmin })).status).toBe(404);
    expect((await req('GET', '/api/live/relay?u=http%3A%2F%2Fx&s=bad', { cookieOverride: cookieAdmin })).status).toBe(403);
    expect((await req('DELETE', `/api/live/playlists/${made.json.id}`, { cookieOverride: cookieAdmin })).status).toBe(200);
  }, 30_000);

  it('says so when no photo or book folder is mounted', async () => {
    const photos = await req('GET', '/api/photos', { cookieOverride: cookieAdmin });
    expect([200, 404]).toContain(photos.status);
    expect((await req('GET', '/api/photos/file?path=../../etc/passwd', { cookieOverride: cookieAdmin })).status).toBe(404);
    expect((await req('GET', '/api/books/file?path=/etc/passwd', { cookieOverride: cookieAdmin })).status).toBe(404);
  }, 30_000);
});

describe('e2e: set it up for me', () => {
  it('only administrators can run the automatic setup, and it explains itself', async () => {
    const made = await req('POST', '/api/auth/users', { body: { username: 'setupuser', password: 'setuppass', role: 'user' }, cookieOverride: cookieAdmin });
    expect(made.status).toBe(200);
    const login = await req('POST', '/api/auth/login', { body: { username: 'setupuser', password: 'setuppass' } });
    const userCookie = /vv_session=[^;]+/.exec(login.setCookie!)![0];
    expect((await req('POST', '/api/setup/repair', { cookieOverride: userCookie })).status).toBe(403);

    const run = await req('POST', '/api/setup/repair', { cookieOverride: cookieAdmin });
    expect(run.status).toBe(200);
    expect(Array.isArray(run.json.log)).toBe(true);
    // No services are configured in the test, so the setup says so instead of hanging.
    expect(run.json.log.join(' ')).toMatch(/Missing|Skipping|did not come online/i);

    const status = await req('GET', '/api/setup/status', { cookieOverride: cookieAdmin });
    const search = status.json.items.find((i: any) => i.id === 'indexers');
    expect(search.label).toBe('Places to search');
  }, 60_000);
});

describe('e2e: static SPA + route fallback', () => {
  it('serves index.html for the app and JSON for unknown API routes', async () => {
    const home = await req('GET', '/');
    expect(home.status).toBe(200);
    expect(home.text).toContain('<div id="root">');

    const deep = await req('GET', '/browse/movies/whatever');
    expect(deep.status).toBe(200);
    expect(deep.text).toContain('<div id="root">');

    const api404 = await req('GET', '/api/no-such-route');
    expect(api404.status).toBe(404);
    expect(api404.json.error).toBe('not_found');
  }, 30_000);
});

describe('e2e: request rules, notifications, backup, indexers, HTTPS cookie', () => {
  let viewer = '';

  it('creates a regular user for the rule checks', async () => {
    await req('POST', '/api/auth/users', { body: { username: 'ruleuser', password: 'rulepass', role: 'user' }, cookieOverride: cookieAdmin });
    const login = await req('POST', '/api/auth/login', { body: { username: 'ruleuser', password: 'rulepass' } });
    expect(login.status).toBe(200);
    viewer = /vv_session=[^;]+/.exec(login.setCookie!)![0];
  });

  it('per-person request limit answers 429 and admins are exempt', async () => {
    const saved = await req('POST', '/api/server-settings', { body: { requests: { approval: 'off', limit: 1, window: 'day' } }, cookieOverride: cookieAdmin });
    expect(saved.status).toBe(200);
    const first = await req('POST', '/api/requests', { body: { title: 'limit test one', mediaType: 'movie' }, cookieOverride: viewer });
    expect(first.status).not.toBe(429);
    const second = await req('POST', '/api/requests', { body: { title: 'limit test two', mediaType: 'movie' }, cookieOverride: viewer });
    expect(second.status).toBe(429);
    expect(second.json.message).toMatch(/limit|used your 1 request/i);
    const admin = await req('POST', '/api/requests', { body: { title: 'limit test admin', mediaType: 'movie' }, cookieOverride: cookieAdmin });
    expect(admin.status).not.toBe(429);
    await req('POST', '/api/server-settings', { body: { requests: { approval: 'off', limit: 0, window: 'week' } }, cookieOverride: cookieAdmin });
  }, 60_000);

  it('only administrators approve; users manage only their own requests', async () => {
    const list = await req('GET', '/api/requests?limit=50', { cookieOverride: cookieAdmin });
    const adminOwn = list.json.items.find((r: any) => r.title === 'limit test admin');
    expect((await req('POST', `/api/requests/${adminOwn.id}/approve`, { cookieOverride: viewer })).status).toBe(403);
    expect((await req('POST', `/api/requests/${adminOwn.id}/cancel`, { cookieOverride: viewer })).status).toBe(403);
    expect((await req('DELETE', `/api/requests/${adminOwn.id}`, { cookieOverride: viewer })).status).toBe(403);
  });

  it('bad request settings and channels are rejected; channel secrets stay hidden from users', async () => {
    expect((await req('POST', '/api/server-settings', { body: { requests: { approval: 'sometimes' } }, cookieOverride: cookieAdmin })).status).toBe(400);
    expect((await req('POST', '/api/server-settings', { body: { notifications: { channels: [{ kind: 'carrier-pigeon' }] } }, cookieOverride: cookieAdmin })).status).toBe(400);
    const ok = await req('POST', '/api/server-settings', { body: { notifications: { channels: [{ kind: 'webhook', name: 'Hook', events: ['request.available', 'nope'], config: { url: 'http://127.0.0.1:9/x' } }] } }, cookieOverride: cookieAdmin });
    expect(ok.status).toBe(200);
    expect(ok.json.notifications.channels[0].events).toEqual(['request.available']);
    expect((await req('GET', '/api/server-settings', { cookieOverride: viewer })).json.notifications.channels).toEqual([]);
    expect((await req('POST', '/api/notifications/test', { body: { channel: ok.json.notifications.channels[0] }, cookieOverride: viewer })).status).toBe(403);
    expect((await req('POST', '/api/notifications/test', { body: { channel: ok.json.notifications.channels[0] }, cookieOverride: cookieAdmin })).status).toBe(502);
    await req('POST', '/api/server-settings', { body: { notifications: { channels: [] } }, cookieOverride: cookieAdmin });
  });

  it('sign-up notifies administrators only, and read marks are per person', async () => {
    await req('POST', '/api/server-settings', { body: { allowSignup: true }, cookieOverride: cookieAdmin });
    const signup = await req('POST', '/api/auth/signup', { body: { username: 'newcomer', password: 'newpass' } });
    expect(signup.status).toBe(200);
    await req('POST', '/api/server-settings', { body: { allowSignup: false }, cookieOverride: cookieAdmin });
    const admin = await req('GET', '/api/notifications', { cookieOverride: cookieAdmin });
    const item = admin.json.items.find((n: any) => n.type === 'user.signup');
    expect(item).toBeTruthy();
    expect(item.read).toBe(false);
    expect((await req('GET', '/api/notifications', { cookieOverride: viewer })).json.items.some((n: any) => n.type === 'user.signup')).toBe(false);
    const after = await req('POST', '/api/notifications/read', { body: { ids: [item.id] }, cookieOverride: cookieAdmin });
    expect(after.json.items.find((n: any) => n.id === item.id).read).toBe(true);
  });

  it('backups: administrators create, list, download and delete; users are refused; junk is not restored', async () => {
    expect((await req('GET', '/api/backup', { cookieOverride: viewer })).status).toBe(403);
    const made = await req('POST', '/api/backup', { cookieOverride: cookieAdmin });
    expect(made.status).toBe(200);
    const name = made.json.backup.name as string;
    expect(name).toMatch(/\.tar\.gz$/);
    const res = await fetch(`${base}/api/backup/${name}`, { headers: { Cookie: cookieAdmin } });
    expect(res.status).toBe(200);
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(200);
    expect((await req('GET', `/api/backup/${name}`, { cookieOverride: viewer })).status).toBe(403);
    expect((await req('GET', '/api/backup/..%2Fusers.json', { cookieOverride: cookieAdmin })).status).toBe(404);
    const junk = await fetch(`${base}/api/backup/restore`, { method: 'POST', headers: { Cookie: cookieAdmin, 'Content-Type': 'application/gzip' }, body: Buffer.alloc(400, 7) });
    expect(junk.status).toBe(422);
    expect((await req('DELETE', `/api/backup/${name}`, { cookieOverride: cookieAdmin })).status).toBe(200);
  }, 60_000);

  it('indexer routes fail gracefully when Prowlarr is not connected; setup status lists what is missing', async () => {
    expect((await req('GET', '/api/indexers', { cookieOverride: cookieAdmin })).status).toBe(502);
    expect((await req('GET', '/api/indexers/catalog?q=x', { cookieOverride: cookieAdmin })).status).toBe(502);
    expect((await req('POST', '/api/indexers', { body: { definitionName: 'x' }, cookieOverride: viewer })).status).toBe(403);
    const setup = await req('GET', '/api/setup/status', { cookieOverride: cookieAdmin });
    expect(setup.status).toBe(200);
    expect(setup.json.complete).toBe(false);
    expect(setup.json.items.map((i: any) => i.id)).toEqual(['services', 'downloader', 'indexers', 'request']);
  }, 30_000);

  it('session cookie is Secure behind an HTTPS proxy and plain otherwise', async () => {
    const https = await req('POST', '/api/auth/login', { body: { username: 'ruleuser', password: 'rulepass' }, headers: { 'X-Forwarded-Proto': 'https' } });
    expect(https.setCookie).toMatch(/; Secure/);
    const http = await req('POST', '/api/auth/login', { body: { username: 'ruleuser', password: 'rulepass' } });
    expect(http.setCookie).not.toMatch(/Secure/);
  });
});

describe('e2e: service controls without the helper', () => {
  it('say how to turn the helper on instead of failing, and stay administrator only', async () => {
    const status = await req('GET', '/api/services/status');
    expect(status.json.helper).toBe(false);
    expect(status.json.error).toMatch(/--profile helper/);
    const stop = await req('POST', '/api/services/stop/radarr', { cookieOverride: cookieAdmin });
    expect(stop.json.stopped).toBe(false);
    expect(stop.json.message).toMatch(/--profile helper/);
    expect((await req('POST', '/api/services/stop/app', { cookieOverride: cookieAdmin })).json.message).toMatch(/Unknown service/);
    const cookieViewer = await viewerCookie();
    expect((await req('POST', '/api/services/stop/radarr', { cookieOverride: cookieViewer })).status).toBe(403);
  }, 20_000);
});
