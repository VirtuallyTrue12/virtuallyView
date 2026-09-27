import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type InjectOptions } from 'fastify';

process.env.VV_DATA_DIR = mkdtempSync(join(tmpdir(), 'vv-media-age-'));

const restrictedMovie = {
  id: 'radarr-1',
  title: 'Restricted Movie',
  type: 'movie',
  certification: 'R',
  year: 2020,
  status: 'available',
  createdAt: new Date(),
  updatedAt: new Date(),
  provider: { metadata: { tmdbId: 42 } }
};

const radarrGetItem = vi.fn(async (id: string) => (id === restrictedMovie.id ? restrictedMovie : null));
const radarrGetCast = vi.fn(async () => []);
const sonarrGetItem = vi.fn(async () => null);

vi.mock('../../apps/server/src/services/registry.js', () => ({
  getAdapter: (key: string) => {
    if (key === 'radarr') return { getItem: radarrGetItem, getItems: vi.fn(async () => []), getCast: radarrGetCast };
    if (key === 'sonarr') return { getItem: sonarrGetItem, getItems: vi.fn(async () => []) };
    return { getItem: vi.fn(async () => null), getItems: vi.fn(async () => []) };
  }
}));

const findTrailer = vi.fn(async () => 'yt-trailer-id');
vi.mock('../../apps/server/src/services/trailers.js', () => ({ findTrailer: (...args: unknown[]) => findTrailer(...args) }));

const outboundFetch = vi.fn(async () => ({ ok: false }));
vi.mock('../../apps/server/src/services/outbound.js', () => ({ outboundFetch: (...args: unknown[]) => outboundFetch(...args) }));

const ensureCast = vi.fn(async (mediaId: string, title: string) => ({ mediaId, title, cast: [], source: 'none' }));
vi.mock('../../apps/server/src/services/cast.js', () => ({
  ensureCast: (...args: unknown[]) => ensureCast(...(args as [string, string])),
  freshCast: vi.fn(() => null),
  getCastCache: vi.fn(() => null),
  setCastCache: vi.fn()
}));

vi.mock('../../apps/server/src/services/concert-movies.js', () => ({
  sweepConcertMovies: vi.fn(async () => undefined),
  withoutConcerts: (items: unknown[]) => items
}));
vi.mock('../../apps/server/src/services/music-video-library.js', () => ({ liveFilerDeps: () => ({}) }));

const mediaRoutes = (await import('../../apps/server/src/routes/media.js')).default;
const { runAsActor } = await import('../../apps/server/src/services/user-context.js');

let app: ReturnType<typeof Fastify>;
beforeEach(async () => {
  vi.clearAllMocks();
  radarrGetItem.mockImplementation(async (id: string) => (id === restrictedMovie.id ? restrictedMovie : null));
  radarrGetCast.mockResolvedValue([]);
  outboundFetch.mockResolvedValue({ ok: false } as never);
  ensureCast.mockImplementation(async (mediaId: string, title: string) => ({ mediaId, title, cast: [], source: 'none' }));
  app = Fastify();
  app.addHook('onRequest', (request, _reply, done) => {
    const header = request.headers['x-test-actor'];
    const actor = typeof header === 'string' ? JSON.parse(header) : { userId: 'system', username: 'system', role: 'system' };
    runAsActor(actor, done);
  });
  await app.register(mediaRoutes);
});
afterEach(async () => { await app.close(); });

const restrictedViewer = { userId: 'kid', username: 'kid', role: 'user' as const, maxRating: 'PG-13' };
const unrestrictedViewer = { userId: 'adult', username: 'adult', role: 'admin' as const };

const injectAs = (actor: typeof restrictedViewer | typeof unrestrictedViewer, opts: InjectOptions) =>
  app.inject({ ...opts, headers: { ...opts.headers, 'x-test-actor': JSON.stringify(actor) } });

describe('a restricted viewer cannot learn about a title above their limit through a side door', () => {
  it('blocks the trailer lookup, and never reaches out for one', async () => {
    const res = await injectAs(restrictedViewer, { method: 'GET', url: '/api/media/radarr-1/trailer' });
    expect(res.statusCode).toBe(403);
    expect(findTrailer).not.toHaveBeenCalled();
  });

  it('blocks the description lookup, and never reaches out for one', async () => {
    const res = await injectAs(restrictedViewer, { method: 'GET', url: '/api/media/radarr-1/description' });
    expect(res.statusCode).toBe(403);
    expect(outboundFetch).not.toHaveBeenCalled();
  });

  it('blocks the verify diagnostic', async () => {
    const res = await injectAs(restrictedViewer, { method: 'GET', url: '/api/media/radarr-1/verify' });
    expect(res.statusCode).toBe(403);
  });

  it('blocks the movie cast lookup, and never fetches or caches it', async () => {
    const res = await injectAs(restrictedViewer, { method: 'GET', url: '/api/movies/radarr-1/cast' });
    expect(res.statusCode).toBe(403);
    expect(radarrGetCast).not.toHaveBeenCalled();
    expect(ensureCast).not.toHaveBeenCalled();
  });

  it('still allows all four for a viewer with no age limit', async () => {
    expect((await injectAs(unrestrictedViewer, { method: 'GET', url: '/api/media/radarr-1/trailer' })).statusCode).toBe(200);
    expect((await injectAs(unrestrictedViewer, { method: 'GET', url: '/api/media/radarr-1/description' })).statusCode).toBe(200);
    expect((await injectAs(unrestrictedViewer, { method: 'GET', url: '/api/media/radarr-1/verify' })).statusCode).toBe(200);
    expect((await injectAs(unrestrictedViewer, { method: 'GET', url: '/api/movies/radarr-1/cast' })).statusCode).toBe(200);
  });
});
