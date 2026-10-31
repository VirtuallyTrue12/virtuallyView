import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type InjectOptions } from 'fastify';

const dir = mkdtempSync(join(tmpdir(), 'vv-personal-home-'));
process.env.VV_DATA_DIR = dir;

const ratingRoutes = (await import('../../apps/server/src/routes/ratings.js')).default;
const homeLayoutRoutes = (await import('../../apps/server/src/routes/home-layout.js')).default;
const { parseThumb } = await import('../../apps/server/src/routes/ratings.js');
const { parseLayout } = await import('../../apps/server/src/routes/home-layout.js');
const { runAsActor } = await import('../../apps/server/src/services/user-context.js');

const ana = { userId: 'ana', username: 'ana', role: 'user' as const };
const ben = { userId: 'ben', username: 'ben', role: 'user' as const };

const app = Fastify();
app.addHook('onRequest', (request, _reply, done) => {
  const header = request.headers['x-test-actor'];
  const actor = typeof header === 'string' ? JSON.parse(header) : ana;
  runAsActor(actor, done);
});

beforeAll(async () => {
  await app.register(ratingRoutes);
  await app.register(homeLayoutRoutes);
  await app.ready();
});
afterAll(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

const as = (actor: typeof ana, opts: InjectOptions) =>
  app.inject({ ...opts, headers: { ...opts.headers, 'x-test-actor': JSON.stringify(actor) } });

describe('thumbs ratings route', () => {
  it('accepts only 1, -1 or 0 as a thumb', () => {
    expect([1, -1, 0].map(parseThumb)).toEqual([1, -1, 0]);
    for (const bad of ['1', 2, -2, 0.5, null, undefined, true, {}]) expect(parseThumb(bad)).toBeNull();
  });

  it('sets, changes and clears a thumb, and keeps it per viewer', async () => {
    const up = await as(ana, { method: 'POST', url: '/api/ratings/movie/radarr-7', payload: { thumb: 1 } });
    expect(up.statusCode).toBe(200);
    expect(up.json()).toEqual({ mediaType: 'movie', mediaId: 'radarr-7', thumb: 1 });

    const read = await as(ana, { method: 'GET', url: '/api/ratings/movie/radarr-7' });
    expect(read.json().thumb).toBe(1);

    const down = await as(ana, { method: 'POST', url: '/api/ratings/movie/radarr-7', payload: { thumb: -1 } });
    expect(down.json().thumb).toBe(-1);

    const cleared = await as(ana, { method: 'POST', url: '/api/ratings/movie/radarr-7', payload: { thumb: 0 } });
    expect(cleared.json().thumb).toBe(0);

    await as(ana, { method: 'POST', url: '/api/ratings/series/sonarr-7', payload: { thumb: 1 } });
    const otherViewer = await as(ben, { method: 'GET', url: '/api/ratings/series/sonarr-7' });
    expect(otherViewer.json().thumb).toBe(0);
  });

  it('rejects a bad media type', async () => {
    const res = await as(ana, { method: 'POST', url: '/api/ratings/artist/lidarr-1', payload: { thumb: 1 } });
    expect(res.statusCode).toBe(400);
    const read = await as(ana, { method: 'GET', url: '/api/ratings/episode/ep-1' });
    expect(read.statusCode).toBe(400);
  });

  it('rejects a bad thumb value', async () => {
    for (const payload of [{ thumb: 2 }, { thumb: '1' }, { thumb: -5 }, {}]) {
      const res = await as(ana, { method: 'POST', url: '/api/ratings/movie/radarr-7', payload });
      expect(res.statusCode).toBe(400);
    }
  });
});

describe('home layout route', () => {
  it('refuses a layout that is not the right shape', () => {
    expect(parseLayout({})).toBeNull();
    expect(parseLayout({ rails: 'trending' })).toBeNull();
    expect(parseLayout({ rails: [{ id: 'Bad Id!', hidden: false, position: 0 }] })).toBeNull();
    expect(parseLayout({ rails: [{ id: 'recent', hidden: 'yes', position: 0 }] })).toBeNull();
    expect(parseLayout({ rails: [{ id: 'recent', hidden: false, position: 1000 }] })).toBeNull();
    expect(parseLayout({ rails: [{ id: 'recent', hidden: false, position: 1.5 }] })).toBeNull();
    expect(parseLayout({ rails: [] })).toEqual([]);
  });

  it('saves, reads back and resets one viewer\'s layout', async () => {
    const saved = await as(ana, {
      method: 'PUT', url: '/api/home-layout',
      payload: { rails: [{ id: 'trending-movies', hidden: true, position: 0 }, { id: 'recent', hidden: false, position: 1 }] }
    });
    expect(saved.statusCode).toBe(200);

    const read = await as(ana, { method: 'GET', url: '/api/home-layout' });
    expect(read.json().rails).toEqual([
      { id: 'trending-movies', hidden: true, position: 0 },
      { id: 'recent', hidden: false, position: 1 }
    ]);

    const others = await as(ben, { method: 'GET', url: '/api/home-layout' });
    expect(others.json().rails).toEqual([]);

    const bad = await as(ana, { method: 'PUT', url: '/api/home-layout', payload: { rails: [{ id: 'x y', hidden: false, position: 0 }] } });
    expect(bad.statusCode).toBe(400);

    const reset = await as(ana, { method: 'PUT', url: '/api/home-layout', payload: { rails: [] } });
    expect(reset.statusCode).toBe(200);
    expect((await as(ana, { method: 'GET', url: '/api/home-layout' })).json().rails).toEqual([]);
  });
});

describe('the household top 10 counts what is in the database', () => {
  it('counts viewers across users from the watch rows', async () => {
    const { run } = await import('../../apps/server/src/db/app-db.js');
    const { householdViewRows } = await import('../../apps/server/src/services/progress.js');
    const { topHousehold } = await import('../../apps/server/src/services/home-rails.js');
    const now = new Date();
    const recent = new Date(now.getTime() - 60_000).toISOString();
    const old = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const insert = (userId: string, mediaType: string, mediaId: string, updatedAt: string, context: string | null = null) =>
      run(
        `INSERT INTO watch_progress (user_id, media_type, media_id, position_seconds, duration_seconds, percent, updated_at, context)
         VALUES (?, ?, ?, 10, 100, 10, ?, ?)`,
        userId, mediaType, mediaId, updatedAt, context
      );
    insert('ana', 'movie', 'radarr-901', recent);
    insert('ben', 'movie', 'radarr-901', recent);
    insert('ben', 'episode', 'ep-901', recent, 'sonarr-902');
    insert('ana', 'movie', 'radarr-903', old);

    const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const rows = householdViewRows(since).map(r => ({ userId: r.userId, id: r.mediaId, at: r.at }));
    const top = topHousehold(rows, now, 7, 10);
    expect(top.map(t => [t.id, t.viewers])).toEqual([['radarr-901', 2], ['sonarr-902', 1]]);
  });
});
